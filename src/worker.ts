export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  CACHE_BUCKET: R2Bucket;
  GOOGLE_MAPS_API_KEY?: string;
  GOOGLE_VISION_API_KEY?: string;
  GOOGLE_MAPS_LANGUAGE?: string;
  ALLOWED_ACCESS_EMAILS?: string;
}

type Json = Record<string, unknown>;

const DAY = 60 * 60 * 24;
const TTL_365_DAYS = 365 * DAY;
const CACHE_MAX_AGE_SECONDS = DAY;
const GEOCODE_TTL_SECONDS = 30 * DAY;

const PRICES = {
  placesNearby: 0.032,
  streetViewStatic: 0.007,
  visionAnnotate: 0.0015,
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/geocode/autobbox" && request.method === "POST") {
      return withErrorHandling(() => handleGeocodeAutoBbox(request));
    }
    if (url.pathname === "/api/overpass/segment" && request.method === "POST") {
      return withErrorHandling(() => handleOverpassSegment(request));
    }
    if (url.pathname === "/api/paid/places" && request.method === "POST") {
      return withErrorHandling(() => handlePaidPlaces(request, env, ctx));
    }
    if (url.pathname === "/api/paid/streetview" && request.method === "POST") {
      return withErrorHandling(() => handlePaidStreetView(request, env, ctx));
    }
    if (url.pathname === "/api/paid/route-scenery" && request.method === "POST") {
      return withErrorHandling(() => handlePaidRouteScenery(request, env, ctx));
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleGeocodeAutoBbox(request: Request): Promise<Response> {
  const body = await requireJson(request);
  const query = String(body.query || "").trim();
  const countryCode = String(body.countryCode || "").trim().toLowerCase();
  if (!query) {
    throw new Error("query is required");
  }

  const cacheKey = await buildCacheKey("geocode-autobbox-v1", {
    query: query.toLowerCase(),
    countryCode,
  });
  const edgeReq = new Request(`https://cache.local/geocode/${cacheKey}`);
  const edgeHit = await caches.default.match(edgeReq);
  if (edgeHit) {
    const cached = (await edgeHit.json()) as Json;
    return json(cached);
  }

  const normalizedCountry = /^[a-z]{2}$/.test(countryCode) ? countryCode : "";

  let items: Array<Record<string, unknown>> = [];
  let resolvedCountryCode = "";

  if (normalizedCountry === "hk") {
    const hkItems = await fetchNominatimSearch(query, "hk");
    if (hkItems.length > 0) {
      items = hkItems;
      resolvedCountryCode = "hk";
    } else {
      const cnQueryCandidates = [`香港${query}`, `Hong Kong ${query}`, query];
      for (const q of cnQueryCandidates) {
        const cnItems = await fetchNominatimSearch(q, "cn");
        if (cnItems.length > 0) {
          items = cnItems;
          resolvedCountryCode = "cn";
          break;
        }
      }
    }
  } else if (normalizedCountry) {
    const filteredItems = await fetchNominatimSearch(query, normalizedCountry);
    if (filteredItems.length > 0) {
      items = filteredItems;
      resolvedCountryCode = normalizedCountry;
    }
  } else {
    items = await fetchNominatimSearch(query, "");
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Geocode no result");
  }

  const first = items[0] || {};
  const bb = Array.isArray(first.boundingbox) ? (first.boundingbox as string[]) : [];
  let south = Number.NaN;
  let north = Number.NaN;
  let west = Number.NaN;
  let east = Number.NaN;

  if (bb.length === 4) {
    south = Number(bb[0]);
    north = Number(bb[1]);
    west = Number(bb[2]);
    east = Number(bb[3]);

    const midLat = (south + north) / 2;
    const midLon = (west + east) / 2;
    const latHalf = Math.max(Math.abs(north - south) / 2, 0.005);
    const lonHalf = Math.max(Math.abs(east - west) / 2, 0.005);
    south = midLat - latHalf;
    north = midLat + latHalf;
    west = midLon - lonHalf;
    east = midLon + lonHalf;
  } else {
    const lat = Number(first.lat);
    const lon = Number(first.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new Error("Geocode invalid coordinates");
    }
    const radius = 0.008;
    south = lat - radius;
    north = lat + radius;
    west = lon - radius;
    east = lon + radius;
  }

  const payload = {
    ok: true,
    query,
    countryCode: resolvedCountryCode ? resolvedCountryCode.toUpperCase() : (normalizedCountry ? normalizedCountry.toUpperCase() : null),
    displayName: String(first.display_name || query),
    bbox: {
      south,
      west,
      north,
      east,
    },
  };

  await caches.default.put(
    edgeReq,
    new Response(JSON.stringify(payload), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": `public, max-age=${GEOCODE_TTL_SECONDS}`,
      },
    }),
  );

  return json(payload);
}

async function fetchNominatimSearch(query: string, countryCode = ""): Promise<Array<Record<string, unknown>>> {
  const p = new URLSearchParams({
    q: query,
    format: "jsonv2",
    limit: "1",
    addressdetails: "1",
  });
  if (countryCode) {
    p.set("countrycodes", countryCode);
  }

  const url = `https://nominatim.openstreetmap.org/search?${p.toString()}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      accept: "application/json",
      "user-agent": "AlaViaBlindMap/0.1 (contact: yoofun@gmail.com)",
    },
  });
  if (!res.ok) {
    throw new Error(`Geocode error: ${res.status}`);
  }
  const items = (await res.json()) as Array<Record<string, unknown>>;
  return Array.isArray(items) ? items : [];
}

async function handleOverpassSegment(request: Request): Promise<Response> {
  const body = await requireJson(request);
  const roadName = String(body.roadName || "").trim();
  const bbox = (body.bbox || {}) as Json;
  const south = Number(bbox.south);
  const west = Number(bbox.west);
  const north = Number(bbox.north);
  const east = Number(bbox.east);

  if (!roadName) {
    throw new Error("roadName is required");
  }
  if (![south, west, north, east].every(Number.isFinite)) {
    throw new Error("bbox must include south, west, north, east");
  }

  const normRoadName = normalizeRoadName(roadName);
  const queryTokens = tokenizeRoadQuery(roadName);

  const initialBbox: BBox = { south, west, north, east };
  let currentBbox: BBox = { ...initialBbox };
  let stabilizedReason = "max_iterations_reached";
  let iterationCount = 0;
  let previousMatchedIds = new Set<number>();

  let overpassResult: { data: Json; endpoint: string } | null = null;
  let parsed: ParsedOverpass | null = null;
  let targetWays: Array<{ id: number; nodes: number[]; tags: Json }> = [];
  let allHighways: Array<{ id: number; nodes: number[]; tags: Json }> = [];

  for (let i = 1; i <= 6; i += 1) {
    iterationCount = i;
    overpassResult = await fetchOverpassJson(buildOverpassQuery(currentBbox));
    parsed = parseOverpassData(overpassResult.data);
    allHighways = parsed.allHighways;
    targetWays = findTargetWays(allHighways, normRoadName, queryTokens);

    if (!targetWays.length) {
      stabilizedReason = i === 1 ? "no_matched_way" : "matched_way_lost";
      break;
    }

    const matchedIds = new Set(targetWays.map((w) => w.id));
    if (i > 1 && setEquals(previousMatchedIds, matchedIds)) {
      stabilizedReason = "matched_ways_stable";
      break;
    }

    const expansion = expandBBoxByConnectivity(currentBbox, targetWays, parsed.nodes, 1.2, 1.2);
    if (!expansion.changed) {
      stabilizedReason = expansion.clamped ? "bbox_clamped" : "connectivity_bounds_stable";
      break;
    }

    previousMatchedIds = matchedIds;
    currentBbox = expansion.bbox;

    if (i === 6) {
      stabilizedReason = "max_iterations_reached";
    }
  }

  if (!overpassResult || !parsed) {
    throw new Error("Overpass query failed");
  }

  const nodes = parsed.nodes;

  if (!targetWays.length) {
    return json({
      roadName,
      totalLengthMeters: 0,
      intersections: [],
      warning: "找不到符合路段名稱的道路，請確認路段名稱或調整 bbox 範圍。",
      diagnostics: {
        endpoint: overpassResult.endpoint,
        allHighwayWays: allHighways.length,
        matchedWays: 0,
        iterations: iterationCount,
        stabilizedReason,
        finalBBox: currentBbox,
      },
    });
  }

  const nodeUsage = new Map<number, number>();
  const nodeToWays = new Map<number, number[]>();

  for (const w of allHighways) {
    for (const nid of w.nodes) {
      nodeUsage.set(nid, (nodeUsage.get(nid) || 0) + 1);
      const arr = nodeToWays.get(nid) || [];
      arr.push(w.id);
      nodeToWays.set(nid, arr);
    }
  }

  const wayById = new Map<number, { id: number; nodes: number[]; tags: Json }>();
  for (const w of allHighways) {
    wayById.set(w.id, w);
  }

  const orderedNodeIds = flattenOrderedNodeIds(targetWays);
  const intersectionsRaw: Array<{ id: number; lat: number; lon: number; name: string; crossStreets: string[]; type: string }> = [];

  for (let i = 0; i < orderedNodeIds.length; i += 1) {
    const nid = orderedNodeIds[i];
    const node = nodes.get(nid);
    if (!node) {
      continue;
    }

    const usage = nodeUsage.get(nid) || 0;
    if (usage <= 1) {
      continue;
    }

    const linkedWays = [...new Set(nodeToWays.get(nid) || [])]
      .map((id) => wayById.get(id))
      .filter(Boolean) as Array<{ id: number; nodes: number[]; tags: Json }>;

    const crossNames = linkedWays
      .map((w) => String(w.tags["name:zh"] || w.tags.name || ""))
      .map((n) => n.trim())
      .filter((n) => n && normalizeRoadName(n) !== normRoadName);

    const uniqueCross = [...new Set(crossNames)];
    const baseName = String(node.tags["name:zh"] || node.tags.name || "").trim();
    const intersectionName =
      baseName || `${roadName} × ${uniqueCross[0] || "未命名道路"}`;

    intersectionsRaw.push({
      id: nid,
      lat: node.lat,
      lon: node.lon,
      name: intersectionName,
      crossStreets: uniqueCross,
      type: classifyIntersection(linkedWays.length),
    });
  }

  const unique = dedupeIntersections(intersectionsRaw);
  const intersections = unique.map((cur, index) => {
    const next = unique[index + 1];
    if (!next) {
      return {
        ...cur,
        bearingToNext: null,
        directionToNext: null,
        distanceToNext: 0,
      };
    }

    const bearing = bearingDegrees(cur, next);
    return {
      ...cur,
      bearingToNext: Math.round(bearing),
      directionToNext: headingLabel(bearing),
      distanceToNext: Math.round(haversineMeters(cur, next)),
    };
  });

  let totalLengthMeters = 0;
  for (let i = 0; i < intersections.length - 1; i += 1) {
    totalLengthMeters += Number(intersections[i].distanceToNext || 0);
  }

  const warning = intersections.length === 0
    ? "Overpass 有回傳道路資料，但目前條件下沒有可辨識路口。請放大 bbox 或改用更完整路段名稱。"
    : null;

  return json({
    roadName,
    totalLengthMeters,
    intersections,
    warning,
    diagnostics: {
      endpoint: overpassResult.endpoint,
      allHighwayWays: allHighways.length,
      matchedWays: targetWays.length,
      rawElements: parsed.elements.length,
      iterations: iterationCount,
      stabilizedReason,
      initialBBox: initialBbox,
      finalBBox: currentBbox,
    },
  });
}

async function fetchOverpassJson(query: string): Promise<{ data: Json; endpoint: string }> {
  const endpoints = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
  ];

  let lastStatus = 0;
  for (const base of endpoints) {
    const url = `${base}?data=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        "user-agent": "AlaViaBlindMap/0.1 (contact: yoofun@gmail.com)",
      },
    });
    lastStatus = res.status;
    if (res.ok) {
      return {
        data: (await res.json()) as Json,
        endpoint: base,
      };
    }
  }

  throw new Error(`Overpass error: ${lastStatus}`);
}

async function withErrorHandling(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return json({ error: message }, 500);
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function requireJson(request: Request): Promise<Json> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error("Request must use application/json");
  }
  return (await request.json()) as Json;
}

function requireUserConfirmedPaidCall(body: Json): void {
  if (body.userConfirmedPaidCall !== true) {
    throw new Error("Paid API calls require explicit user action");
  }
}

function requireGoogleMapsKey(env: Env): string {
  if (!env.GOOGLE_MAPS_API_KEY) {
    throw new Error("GOOGLE_MAPS_API_KEY is not configured");
  }
  return env.GOOGLE_MAPS_API_KEY;
}

function requireGoogleVisionKey(env: Env): string {
  const key = env.GOOGLE_VISION_API_KEY || env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    throw new Error("GOOGLE_VISION_API_KEY is not configured");
  }
  return key;
}

function requireAllowedUser(request: Request, env: Env): void {
  const configured = (env.ALLOWED_ACCESS_EMAILS || "").trim();
  if (!configured) {
    return;
  }

  const host = new URL(request.url).hostname.toLowerCase();
  if (host === "127.0.0.1" || host === "localhost") {
    return;
  }

  const current = (request.headers.get("cf-access-authenticated-user-email") || "").trim().toLowerCase();
  const allowed = configured
    .split(",")
    .map((it) => it.trim().toLowerCase())
    .filter(Boolean);

  if (!current || !allowed.includes(current)) {
    throw new Error("This API is restricted to invited users");
  }
}

async function handlePaidPlaces(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  requireAllowedUser(request, env);
  await ensureD1Schema(env);
  const body = await requireJson(request);
  requireUserConfirmedPaidCall(body);

  const intersections = Array.isArray(body.intersections) ? body.intersections : [];
  const radius = Number(body.radius ?? 50);
  if (intersections.length === 0) {
    throw new Error("intersections is required");
  }

  const apiKey = requireGoogleMapsKey(env);
  const language = env.GOOGLE_MAPS_LANGUAGE || "zh-TW";

  const lines: string[] = [];
  let billableCalls = 0;
  let cacheHits = 0;

  for (const item of intersections) {
    const row = item as Json;
    const lat = Number(row.lat);
    const lon = Number(row.lon);
    const name = String(row.name || `${lat},${lon}`);

    const payload = { lat: round6(lat), lon: round6(lon), radius, language };
    const cached = await getOrCreateCached(
      env,
      "places",
      payload,
      async () => {
        const places = await fetchGooglePlaces(apiKey, payload.lat, payload.lon, payload.radius, payload.language);
        return places;
      },
      TTL_365_DAYS,
    );

    if (cached.cacheHit) {
      cacheHits += 1;
    } else {
      billableCalls += 1;
    }

    const list = Array.isArray((cached.data as Json).results) ? ((cached.data as Json).results as Json[]) : [];
    const top = list.slice(0, 5).map((p) => {
      const title = String(p.name || "未命名地標");
      const types = Array.isArray(p.types) ? (p.types as string[]).slice(0, 2).join("/") : "";
      return `- ${title}${types ? `（${types}）` : ""}`;
    });

    lines.push(`${name}`);
    lines.push(top.length ? top.join("\n") : "- 無周邊資料");
    lines.push("");
  }

  const estimatedUsd = intersections.length * PRICES.placesNearby;
  const actualUsd = billableCalls * PRICES.placesNearby;
  await recordBilling(env, {
    provider: "places",
    cacheHit: billableCalls === 0 ? 1 : 0,
    estimatedUsd,
    actualUsd,
  });

  const text = [
    "周邊地標查詢完成。",
    `預估請求 ${intersections.length} 次，預估費用 $${estimatedUsd.toFixed(3)}。`,
    `實際計費 ${billableCalls} 次，cache 命中 ${cacheHits} 次，實際費用 $${actualUsd.toFixed(3)}。`,
    "",
    lines.join("\n"),
  ].join("\n");

  return json({
    ok: true,
    provider: "places",
    estimatedCalls: intersections.length,
    billableCalls,
    cacheHits,
    estimatedUsd,
    actualUsd,
    text,
  });
}

async function handlePaidStreetView(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  requireAllowedUser(request, env);
  await ensureD1Schema(env);
  const body = await requireJson(request);
  requireUserConfirmedPaidCall(body);

  const lat = Number(body.lat);
  const lon = Number(body.lon);
  const heading = Number(body.heading ?? 0);
  const fov = Number(body.fov ?? 90);
  const pitch = Number(body.pitch ?? 0);
  const language = env.GOOGLE_MAPS_LANGUAGE || "zh-TW";

  const mapsKey = requireGoogleMapsKey(env);
  const visionKey = requireGoogleVisionKey(env);

  const headings = [heading, heading + 90, heading + 270].map((h) => normalizeHeading(h));
  let billableImages = 0;
  let billableVision = 0;
  let cacheHits = 0;

  const blocks: string[] = [];

  for (const h of headings) {
    const payload = {
      lat: round6(lat),
      lon: round6(lon),
      heading: h,
      fov,
      pitch,
      language,
    };

    const cached = await getOrCreateCached(
      env,
      "streetview-vision-v2",
      payload,
      async () => {
        const imageUrl = buildStreetViewUrl(mapsKey, payload);
        const vision = await fetchVisionDescription(visionKey, imageUrl);
        const visionErr = getVisionErrorMessage(vision);
        if (visionErr) {
          throw new Error(`Google Vision 失敗：${visionErr}`);
        }
        return {
          imageUrl,
          vision,
        };
      },
      TTL_365_DAYS,
    );

    if (cached.cacheHit) {
      cacheHits += 1;
    } else {
      billableImages += 1;
      billableVision += 1;
    }

    const visionText = extractVisionText((cached.data as Json).vision as Json);
    blocks.push(`方位 ${headingLabel(h)}：${visionText}`);
  }

  const estimatedCalls = headings.length * 2;
  const estimatedUsd = headings.length * (PRICES.streetViewStatic + PRICES.visionAnnotate);
  const actualUsd = billableImages * PRICES.streetViewStatic + billableVision * PRICES.visionAnnotate;

  await recordBilling(env, {
    provider: "streetview",
    cacheHit: billableImages === 0 ? 1 : 0,
    estimatedUsd,
    actualUsd,
  });

  const text = [
    "街景詳細描述完成。",
    `預估請求 ${estimatedCalls} 次，預估費用 $${estimatedUsd.toFixed(3)}。`,
    `實際計費影像 ${billableImages} 次，Vision ${billableVision} 次，cache 命中 ${cacheHits} 次。`,
    `實際費用 $${actualUsd.toFixed(3)}。`,
    "",
    ...blocks,
  ].join("\n");

  return json({
    ok: true,
    provider: "streetview",
    estimatedCalls,
    billableCalls: billableImages + billableVision,
    cacheHits,
    estimatedUsd,
    actualUsd,
    text,
  });
}

function tokenizeRoadQuery(name: string): string[] {
  const stopWords = new Set([
    "street",
    "st",
    "road",
    "rd",
    "avenue",
    "ave",
    "hong",
    "kong",
    "hongkong",
    "kowloon",
    "hk",
    "香港",
    "九龍",
    "china",
    "中國",
  ]);

  return name
    .split(/[\s,，。.;；:：()（）\-_/]+/)
    .map((it) => normalizeRoadName(it))
    .filter((it) => it.length >= 2)
    .filter((it) => !stopWords.has(it));
}

function collectWayNames(tags: Json): string[] {
  const keys = ["name", "name:zh", "name:en", "official_name", "alt_name", "short_name"];
  const out: string[] = [];
  for (const key of keys) {
    const v = String(tags[key] || "").trim();
    if (v) {
      out.push(v);
      if (v.includes(";")) {
        out.push(...v.split(";").map((x) => x.trim()).filter(Boolean));
      }
    }
  }
  return [...new Set(out)];
}

function isRoadNameMatch(nameNorm: string, queryNorm: string, queryTokens: string[]): boolean {
  if (!nameNorm || !queryNorm) {
    return false;
  }
  if (nameNorm.includes(queryNorm) || queryNorm.includes(nameNorm)) {
    return true;
  }
  return queryTokens.some((token) => token.length >= 2 && (nameNorm.includes(token) || token.includes(nameNorm)));
}
async function handlePaidRouteScenery(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  requireAllowedUser(request, env);
  await ensureD1Schema(env);
  const body = await requireJson(request);
  requireUserConfirmedPaidCall(body);

  const start = body.start as Json;
  const end = body.end as Json;
  const intervalMeters = Number(body.intervalMeters ?? 50);
  const heading = Number(body.heading ?? 0);

  const mapsKey = requireGoogleMapsKey(env);
  const visionKey = requireGoogleVisionKey(env);

  const points = sampleLineByMeters(
    { lat: Number(start.lat), lon: Number(start.lon) },
    { lat: Number(end.lat), lon: Number(end.lon) },
    intervalMeters,
  );

  let billableImages = 0;
  let billableVision = 0;
  let cacheHits = 0;

  const lines: string[] = [];

  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    const distance = i * intervalMeters;

    const payload = {
      lat: round6(p.lat),
      lon: round6(p.lon),
      heading: normalizeHeading(heading),
      fov: 90,
      pitch: 0,
      step: i,
    };

    const cached = await getOrCreateCached(
      env,
      "route-scenery-v2",
      payload,
      async () => {
        const imageUrl = buildStreetViewUrl(mapsKey, {
          lat: payload.lat,
          lon: payload.lon,
          heading: payload.heading,
          fov: payload.fov,
          pitch: payload.pitch,
          language: env.GOOGLE_MAPS_LANGUAGE || "zh-TW",
        });
        const vision = await fetchVisionDescription(visionKey, imageUrl);
        const visionErr = getVisionErrorMessage(vision);
        if (visionErr) {
          throw new Error(`Google Vision 失敗：${visionErr}`);
        }
        return { imageUrl, vision };
      },
      TTL_365_DAYS,
    );

    if (cached.cacheHit) {
      cacheHits += 1;
    } else {
      billableImages += 1;
      billableVision += 1;
    }

    const text = extractVisionText((cached.data as Json).vision as Json);
    lines.push(`${distance}m：${text}`);
  }

  const estimatedCalls = points.length * 2;
  const estimatedUsd = points.length * (PRICES.streetViewStatic + PRICES.visionAnnotate);
  const actualUsd = billableImages * PRICES.streetViewStatic + billableVision * PRICES.visionAnnotate;

  await recordBilling(env, {
    provider: "route-scenery",
    cacheHit: billableImages === 0 ? 1 : 0,
    estimatedUsd,
    actualUsd,
  });

  const text = [
    `沿路景物描述完成，每 ${intervalMeters}m 採樣，共 ${points.length} 點。`,
    `預估請求 ${estimatedCalls} 次，預估費用 $${estimatedUsd.toFixed(3)}。`,
    `實際計費影像 ${billableImages} 次，Vision ${billableVision} 次，cache 命中 ${cacheHits} 次。`,
    `實際費用 $${actualUsd.toFixed(3)}。`,
    "",
    ...lines,
  ].join("\n");

  return json({
    ok: true,
    provider: "route-scenery",
    estimatedCalls,
    billableCalls: billableImages + billableVision,
    cacheHits,
    estimatedUsd,
    actualUsd,
    text,
  });
}

function buildStreetViewUrl(
  apiKey: string,
  args: { lat: number; lon: number; heading: number; fov: number; pitch: number; language: string },
): string {
  const p = new URLSearchParams({
    size: "640x480",
    location: `${args.lat},${args.lon}`,
    heading: String(args.heading),
    fov: String(args.fov),
    pitch: String(args.pitch),
    language: args.language,
    key: apiKey,
  });
  return `https://maps.googleapis.com/maps/api/streetview?${p.toString()}`;
}

async function fetchGooglePlaces(
  apiKey: string,
  lat: number,
  lon: number,
  radius: number,
  language: string,
): Promise<Json> {
  const p = new URLSearchParams({
    location: `${lat},${lon}`,
    radius: String(radius),
    language,
    key: apiKey,
  });

  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${p.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Google Places error: ${res.status}`);
  }

  const jsonBody = (await res.json()) as Json;
  const status = String(jsonBody.status || "");
  if (status !== "OK" && status !== "ZERO_RESULTS") {
    throw new Error(`Google Places status: ${status}`);
  }
  return jsonBody;
}

async function fetchVisionDescription(apiKey: string, imageUri: string): Promise<Json> {
  const url = `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`;
  const reqBody = {
    requests: [
      {
        image: { source: { imageUri } },
        features: [
          { type: "LABEL_DETECTION", maxResults: 6 },
          { type: "OBJECT_LOCALIZATION", maxResults: 8 },
          { type: "TEXT_DETECTION", maxResults: 4 },
        ],
      },
    ],
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(reqBody),
  });

  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as Json;
    const errMsg = extractGoogleErrorMessage(errBody) || `HTTP ${res.status}`;
    return {
      responses: [
        {
          error: {
            code: res.status,
            message: errMsg,
          },
        },
      ],
    };
  }

  return (await res.json()) as Json;
}

function extractGoogleErrorMessage(payload: Json): string {
  const err = (payload.error || {}) as Json;
  const direct = String(err.message || "").trim();
  if (direct) {
    return direct;
  }

  const details = Array.isArray(err.details) ? (err.details as Json[]) : [];
  for (const item of details) {
    const inner = String(item.message || "").trim();
    if (inner) {
      return inner;
    }
  }

  return "";
}

function getVisionErrorMessage(vision: Json): string {
  const responses = Array.isArray(vision.responses) ? (vision.responses as Json[]) : [];
  const first = responses[0] || {};
  const err = (first.error || {}) as Json;
  const code = Number(err.code || 0);
  const message = String(err.message || "").trim();
  if (code >= 400) {
    return message || `HTTP ${code}`;
  }
  return "";
}

function extractVisionText(vision: Json): string {
  const responses = Array.isArray(vision.responses) ? (vision.responses as Json[]) : [];
  const first = responses[0] || {};
  const errMsg = getVisionErrorMessage(vision);
  if (errMsg) {
    return `Vision 失敗：${errMsg}`;
  }
  const labels = Array.isArray(first.labelAnnotations)
    ? (first.labelAnnotations as Json[])
        .slice(0, 4)
        .map((it) => String(it.description || "").trim())
        .filter(Boolean)
    : [];
  const objects = Array.isArray(first.localizedObjectAnnotations)
    ? (first.localizedObjectAnnotations as Json[])
        .slice(0, 4)
        .map((it) => String(it.name || "").trim())
        .filter(Boolean)
    : [];

  const merged = [...new Set([...labels, ...objects])].slice(0, 6);
  return merged.length ? `偵測到：${merged.join("、")}` : "未偵測到明確景物";
}

async function getOrCreateCached(
  env: Env,
  provider: string,
  payload: Json,
  creator: () => Promise<Json>,
  ttlSeconds: number,
): Promise<{ data: Json; cacheHit: boolean }> {
  const cacheKey = await buildCacheKey(provider, payload);

  const edgeReq = new Request(`https://cache.local/${provider}/${cacheKey}`);
  const edgeHit = await caches.default.match(edgeReq);
  if (edgeHit) {
    const data = (await edgeHit.json()) as Json;
    return { data, cacheHit: true };
  }

  const now = nowEpoch();
  const row = await env.DB.prepare(
    "SELECT object_key, expires_at FROM api_cache WHERE cache_key = ?1 AND provider = ?2 LIMIT 1",
  )
    .bind(cacheKey, provider)
    .first<{ object_key: string; expires_at: number }>();

  if (row && row.expires_at > now) {
    const obj = await env.CACHE_BUCKET.get(row.object_key);
    if (obj) {
      const data = (await obj.json()) as Json;
      await env.DB.prepare("UPDATE api_cache SET last_access_at = ?1 WHERE cache_key = ?2").bind(now, cacheKey).run();
      await writeEdgeCache(edgeReq, data);
      return { data, cacheHit: true };
    }
  }

  const data = await creator();
  const expiresAt = now + ttlSeconds;
  const objectKey = `${provider}/${cacheKey}.json`;

  await env.CACHE_BUCKET.put(objectKey, JSON.stringify(data), {
    httpMetadata: {
      contentType: "application/json; charset=utf-8",
      cacheControl: `max-age=${CACHE_MAX_AGE_SECONDS}`,
    },
  });

  await env.DB.prepare(
    `INSERT INTO api_cache (cache_key, provider, object_key, expires_at, created_at, last_access_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?5)
     ON CONFLICT(cache_key) DO UPDATE SET
       provider = excluded.provider,
       object_key = excluded.object_key,
       expires_at = excluded.expires_at,
       last_access_at = excluded.last_access_at`,
  )
    .bind(cacheKey, provider, objectKey, expiresAt, now)
    .run();

  await writeEdgeCache(edgeReq, data);

  return { data, cacheHit: false };
}

async function writeEdgeCache(req: Request, data: Json): Promise<void> {
  const res = new Response(JSON.stringify(data), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${CACHE_MAX_AGE_SECONDS}`,
    },
  });
  await caches.default.put(req, res);
}

async function recordBilling(
  env: Env,
  args: { provider: string; cacheHit: number; estimatedUsd: number; actualUsd: number },
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO billing_events (user_id, provider, cache_hit, estimated_usd, actual_usd, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
  )
    .bind("anonymous", args.provider, args.cacheHit, args.estimatedUsd, args.actualUsd, nowEpoch())
    .run();
}

async function ensureD1Schema(env: Env): Promise<void> {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS api_cache (
      cache_key TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      object_key TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      last_access_at INTEGER NOT NULL
    )`,
  ).run();

  await env.DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_api_cache_provider_expires ON api_cache(provider, expires_at)",
  ).run();

  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS billing_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      provider TEXT NOT NULL,
      cache_hit INTEGER NOT NULL,
      estimated_usd REAL NOT NULL,
      actual_usd REAL,
      created_at INTEGER NOT NULL
    )`,
  ).run();
}

async function buildCacheKey(provider: string, payload: Json): Promise<string> {
  const text = `${provider}:${stableStringify(payload)}`;
  const encoded = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
  return `{${parts.join(",")}}`;
}

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000);
}

function round6(v: number): number {
  return Math.round(v * 1_000_000) / 1_000_000;
}

function normalizeHeading(v: number): number {
  const n = v % 360;
  return n < 0 ? n + 360 : n;
}

function headingLabel(heading: number): string {
  const dirs = ["北", "東北", "東", "東南", "南", "西南", "西", "西北"];
  const idx = Math.round(normalizeHeading(heading) / 45) % 8;
  return dirs[idx];
}

function normalizeRoadName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "").trim();
}

type BBox = { south: number; west: number; north: number; east: number };
type Way = { id: number; nodes: number[]; tags: Json };
type ParsedOverpass = {
  elements: Json[];
  nodes: Map<number, { id: number; lat: number; lon: number; tags: Json }>;
  ways: Way[];
  allHighways: Way[];
};

function buildOverpassQuery(bbox: BBox): string {
  return `
[out:json][timeout:25];
(
  way["highway"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
);
(._;>;);
out body;
`;
}

function parseOverpassData(overpass: Json): ParsedOverpass {
  const elements = Array.isArray(overpass.elements) ? (overpass.elements as Json[]) : [];
  const nodes = new Map<number, { id: number; lat: number; lon: number; tags: Json }>();
  const ways: Way[] = [];

  for (const el of elements) {
    const type = String(el.type || "");
    if (type === "node") {
      const id = Number(el.id);
      nodes.set(id, {
        id,
        lat: Number(el.lat),
        lon: Number(el.lon),
        tags: (el.tags || {}) as Json,
      });
    } else if (type === "way") {
      ways.push({
        id: Number(el.id),
        nodes: Array.isArray(el.nodes) ? (el.nodes as number[]) : [],
        tags: (el.tags || {}) as Json,
      });
    }
  }

  const allHighways = ways.filter((w) => String((w.tags.highway as string) || "").length > 0);
  return { elements, nodes, ways, allHighways };
}

function findTargetWays(allHighways: Way[], normRoadName: string, queryTokens: string[]): Way[] {
  return allHighways.filter((w) => {
    const names = collectWayNames(w.tags);
    return names.some((rawName) => {
      const name = normalizeRoadName(rawName);
      return isRoadNameMatch(name, normRoadName, queryTokens);
    });
  });
}

function setEquals(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const v of a) {
    if (!b.has(v)) {
      return false;
    }
  }
  return true;
}

function expandBBoxByConnectivity(
  base: BBox,
  targetWays: Way[],
  nodes: Map<number, { id: number; lat: number; lon: number; tags: Json }>,
  maxLatSpan: number,
  maxLonSpan: number,
): { bbox: BBox; changed: boolean; clamped: boolean } {
  let minLat = Number.POSITIVE_INFINITY;
  let minLon = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;

  for (const way of targetWays) {
    for (const nid of way.nodes) {
      const node = nodes.get(nid);
      if (!node) {
        continue;
      }
      minLat = Math.min(minLat, node.lat);
      minLon = Math.min(minLon, node.lon);
      maxLat = Math.max(maxLat, node.lat);
      maxLon = Math.max(maxLon, node.lon);
    }
  }

  if (!Number.isFinite(minLat) || !Number.isFinite(minLon) || !Number.isFinite(maxLat) || !Number.isFinite(maxLon)) {
    return { bbox: base, changed: false, clamped: false };
  }

  const latPad = Math.max((maxLat - minLat) * 0.15, 0.003);
  const lonPad = Math.max((maxLon - minLon) * 0.15, 0.003);

  let candidate: BBox = {
    south: Math.min(base.south, minLat - latPad),
    west: Math.min(base.west, minLon - lonPad),
    north: Math.max(base.north, maxLat + latPad),
    east: Math.max(base.east, maxLon + lonPad),
  };

  let clamped = false;
  const before = { ...candidate };
  candidate = clampBBox(candidate, maxLatSpan, maxLonSpan);
  if (
    Math.abs(before.south - candidate.south) > 1e-9 ||
    Math.abs(before.west - candidate.west) > 1e-9 ||
    Math.abs(before.north - candidate.north) > 1e-9 ||
    Math.abs(before.east - candidate.east) > 1e-9
  ) {
    clamped = true;
  }

  const changed =
    Math.abs(base.south - candidate.south) > 1e-6 ||
    Math.abs(base.west - candidate.west) > 1e-6 ||
    Math.abs(base.north - candidate.north) > 1e-6 ||
    Math.abs(base.east - candidate.east) > 1e-6;

  return { bbox: candidate, changed, clamped };
}

function clampBBox(bbox: BBox, maxLatSpan: number, maxLonSpan: number): BBox {
  let south = Math.max(-85, bbox.south);
  let north = Math.min(85, bbox.north);
  let west = Math.max(-180, bbox.west);
  let east = Math.min(180, bbox.east);

  if (south > north) {
    const mid = (south + north) / 2;
    south = mid - 0.005;
    north = mid + 0.005;
  }
  if (west > east) {
    const mid = (west + east) / 2;
    west = mid - 0.005;
    east = mid + 0.005;
  }

  const latSpan = north - south;
  if (latSpan > maxLatSpan) {
    const mid = (south + north) / 2;
    south = mid - maxLatSpan / 2;
    north = mid + maxLatSpan / 2;
  }

  const lonSpan = east - west;
  if (lonSpan > maxLonSpan) {
    const mid = (west + east) / 2;
    west = mid - maxLonSpan / 2;
    east = mid + maxLonSpan / 2;
  }

  return { south, west, north, east };
}

function flattenOrderedNodeIds(ways: Array<{ id: number; nodes: number[] }>): number[] {
  const out: number[] = [];
  for (const w of ways) {
    for (const nid of w.nodes) {
      out.push(nid);
    }
  }
  return out;
}

function classifyIntersection(linkedWayCount: number): string {
  if (linkedWayCount >= 4) {
    return "十字或多向路口";
  }
  if (linkedWayCount === 3) {
    return "T 型路口";
  }
  if (linkedWayCount === 2) {
    return "雙向連接點";
  }
  return "未知";
}

function dedupeIntersections(
  rows: Array<{ id: number; lat: number; lon: number; name: string; crossStreets: string[]; type: string }>,
): Array<{ id: number; lat: number; lon: number; name: string; crossStreets: string[]; type: string }> {
  const seen = new Set<number>();
  const out: Array<{ id: number; lat: number; lon: number; name: string; crossStreets: string[]; type: string }> = [];
  for (const row of rows) {
    if (seen.has(row.id)) {
      continue;
    }
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

function bearingDegrees(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const phi1 = (a.lat * Math.PI) / 180;
  const phi2 = (b.lat * Math.PI) / 180;
  const lambda1 = (a.lon * Math.PI) / 180;
  const lambda2 = (b.lon * Math.PI) / 180;
  const y = Math.sin(lambda2 - lambda1) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambda2 - lambda1);
  return normalizeHeading((Math.atan2(y, x) * 180) / Math.PI);
}

function sampleLineByMeters(
  start: { lat: number; lon: number },
  end: { lat: number; lon: number },
  intervalMeters: number,
): Array<{ lat: number; lon: number }> {
  const total = haversineMeters(start, end);
  if (total <= 0) {
    return [start];
  }

  const count = Math.max(1, Math.ceil(total / intervalMeters));
  const points: Array<{ lat: number; lon: number }> = [];
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    points.push({
      lat: start.lat + (end.lat - start.lat) * t,
      lon: start.lon + (end.lon - start.lon) * t,
    });
  }
  return points;
}

function haversineMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6_371_000;
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dPhi = ((b.lat - a.lat) * Math.PI) / 180;
  const dLambda = ((b.lon - a.lon) * Math.PI) / 180;
  const x = Math.sin(dPhi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLambda / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
