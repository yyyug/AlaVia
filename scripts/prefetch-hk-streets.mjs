#!/usr/bin/env node

import { access, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";

const args = parseArgs(process.argv.slice(2));
const baseUrl = (args.baseUrl || process.env.ALAVIA_BASE_URL || "http://127.0.0.1:8787").replace(/\/+$/, "");
const from = Number(args.from || 1);
const to = Number(args.to || from);
const language = String(args.language || "zh-TW");
const countryCode = "HK";
const streetsFile = "scripts/hk-streets.json";
const refreshStreetList = String(args.refreshStreetList || "false").toLowerCase() === "true";
const warmTiles = String(args.warmTiles || "true").toLowerCase() === "true";
const warmTileRepeats = Math.max(1, Number(args.warmTileRepeats || 3));

if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) {
  console.error("Invalid range. Use --from <start> --to <end>, e.g. --from 1 --to 300");
  process.exit(1);
}

async function main() {
  console.log(`Using API base URL: ${baseUrl}`);
  const indexed = await loadOrCreateIndexedStreetList();

  const selected = indexed.filter((item) => item.index >= from && item.index <= to);
  if (selected.length === 0) {
    throw new Error(`No streets in selected range ${from}-${to}.`);
  }

  console.log(`Processing streets ${from}-${to} (${selected.length} streets), country preference fixed to ${countryCode}.`);

  let totalIntersections = 0;
  let totalSegments = 0;
  let streetsDone = 0;
  let totalTilesWarmed = 0;
  const warmedTiles = new Set();

  for (const item of selected) {
    console.log(`\n[${item.index}] ${item.name}`);

    let bbox;
    try {
      const geo = await postJson("/api/geocode/autobbox", { query: item.name, countryCode });
      bbox = geo?.bbox;
      if (!bbox) {
        console.log("  - skip: no bbox from geocode.");
        continue;
      }
    } catch (err) {
      console.log(`  - skip geocode error: ${err.message}`);
      continue;
    }

    let segmentData;
    try {
      segmentData = await postJson("/api/overpass/segment", { roadName: item.name, bbox });
    } catch (err) {
      console.log(`  - skip segment error: ${err.message}`);
      continue;
    }

    const intersections = Array.isArray(segmentData?.intersections) ? segmentData.intersections : [];
    if (intersections.length === 0) {
      console.log("  - skip: no intersections found.");
      continue;
    }

    totalIntersections += intersections.length;
    streetsDone += 1;
    console.log(`  - intersections: ${intersections.length}`);

    for (let i = 0; i < intersections.length; i += 1) {
      const row = intersections[i];
      const next = intersections[i + 1] || null;
      const heading = Number.isFinite(row?.bearingToNext) ? Number(row.bearingToNext) : 0;

      if (warmTiles) {
        try {
          const warmed = await warmSoundscapeTile(row.lat, row.lon, warmedTiles);
          if (warmed) {
            totalTilesWarmed += 1;
          }
        } catch (err) {
          console.log(`    - tile warm failed at intersection ${i + 1}: ${err.message}`);
        }
      }

      // Check metadata first to avoid unnecessary API calls if no Street View coverage
      let metadataOk = false;
      try {
        const metaResponse = await postJson("/api/streetview/metadata", {
          lat: row.lat,
          lon: row.lon,
        });
        metadataOk = metaResponse?.hasStreetView === true;
        if (!metadataOk) {
          console.log(`    - no Street View coverage at intersection ${i + 1}`);
        }
      } catch (err) {
        console.log(`    - metadata check failed at intersection ${i + 1}: ${err.message}`);
      }

      // Only fetch Street View if metadata indicates coverage
      if (metadataOk) {
        try {
          await postJson("/api/paid/streetview", {
            userConfirmedPaidCall: true,
            lat: row.lat,
            lon: row.lon,
            heading,
            fov: 90,
            pitch: 0,
            language,
          });
        } catch (err) {
          console.log(`    - streetview failed at intersection ${i + 1}: ${err.message}`);
        }
      }

      if (!next) {
        continue;
      }

      try {
        await postJson("/api/osm/route-places", {
          roadName: segmentData.roadName || item.name,
          start: { lat: row.lat, lon: row.lon },
          end: { lat: next.lat, lon: next.lon },
        });
        totalSegments += 1;
      } catch (err) {
        console.log(`    - route OSM failed on segment ${i + 1}: ${err.message}`);
      }
    }

    console.log("  - done");
  }

  console.log("\nCompleted.");
  console.log(`Streets completed: ${streetsDone}`);
  console.log(`Intersections covered: ${totalIntersections}`);
  console.log(`OSM route segments covered: ${totalSegments}`);
  if (warmTiles) {
    console.log(`Soundscape tiles warmed: ${totalTilesWarmed} unique tiles x ${warmTileRepeats} hit(s)`);
  }
  console.log("All successful calls are cached into R2 by the worker.");
}

async function warmSoundscapeTile(lat, lon, warmedTiles) {
  const tile = latLonToTile(lat, lon, 16);
  const key = `${tile.z}/${tile.x}/${tile.y}`;
  if (warmedTiles.has(key)) {
    return false;
  }

  for (let attempt = 0; attempt < warmTileRepeats; attempt += 1) {
    const res = await fetch(`${baseUrl}/tiles/${tile.z}/${tile.x}/${tile.y}.json`, {
      headers: { accept: "application/json" },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}${body ? ` ${body}` : ""}`);
    }
  }

  warmedTiles.add(key);
  return true;
}

function latLonToTile(lat, lon, zoom) {
  const scale = 2 ** zoom;
  const latRad = (lat * Math.PI) / 180;
  return {
    z: zoom,
    x: Math.floor(((lon + 180) / 360) * scale),
    y: Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale),
  };
}

async function loadOrCreateIndexedStreetList() {
  if (!refreshStreetList) {
    const existing = await tryReadIndexedStreets(streetsFile);
    if (existing.length > 0) {
      console.log(`Loaded ${existing.length} indexed streets from ${streetsFile}`);
      return existing;
    }
  }

  console.log("Loading Hong Kong street list from Overpass...");
  const streetNames = await loadHongKongStreetNames();
  if (streetNames.length === 0) {
    throw new Error("No Hong Kong streets found from Overpass.");
  }

  const indexed = streetNames.map((name, idx) => ({ index: idx + 1, name }));
  await writeFile(streetsFile, JSON.stringify(indexed, null, 2), "utf8");
  console.log(`Indexed ${indexed.length} streets. Saved to ${streetsFile}`);
  return indexed;
}

async function tryReadIndexedStreets(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    const text = await readFile(filePath, "utf8");
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const rows = parsed
      .map((item) => ({
        index: Number(item?.index),
        name: String(item?.name || "").trim(),
      }))
      .filter((item) => Number.isInteger(item.index) && item.index > 0 && item.name);
    return rows;
  } catch {
    return [];
  }
}

async function postJson(path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(String(payload?.error || `HTTP ${res.status}`));
  }
  return payload;
}

async function loadHongKongStreetNames() {
  const query = [
    "[out:json][timeout:180];",
    "(",
    "  way[\"highway\"][\"name\"](22.13,113.82,22.58,114.50);",
    ");",
    "out tags;",
  ].join("\n");

  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "user-agent": "AlaViaHKPrefetch/0.1",
    },
    body: new URLSearchParams({ data: query }).toString(),
  });

  if (!res.ok) {
    throw new Error(`Overpass failed: HTTP ${res.status}`);
  }

  const data = await res.json();
  const elements = Array.isArray(data?.elements) ? data.elements : [];
  const names = new Set();
  let missingChineseNameCount = 0;

  for (const el of elements) {
    const tags = el?.tags || {};
    const zhName = String(tags["name:zh-Hant"] || tags["name:zh"] || "").trim();
    if (!zhName) {
      missingChineseNameCount += 1;
      continue;
    }
    names.add(zhName);
  }

  if (missingChineseNameCount > 0) {
    console.log(`Skipped ${missingChineseNameCount} ways without Chinese street names.`);
  }

  return [...names].sort((a, b) => a.localeCompare(b, "zh-Hant"));
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
    out[key] = value;
  }
  return out;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
