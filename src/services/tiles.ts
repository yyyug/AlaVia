import { neon } from "@neondatabase/serverless";
import { PMTiles, type RangeResponse, type Source } from "pmtiles";
import {
  DAY,
  SOUNDSCAPE_HK_PMTILES_KEY,
  SOUNDSCAPE_TILE_MAX_AGE_SECONDS,
  TILE_HOT_CACHE_THRESHOLD,
  TILE_HOT_CACHE_TTL_SECONDS,
} from "../config/constants";
import { nowEpoch } from "../lib/geo-utils";
import { buildCacheKey } from "./cache";

type Json = Record<string, unknown>;

type SoundscapeTileFeature = {
  type: string;
  osm_ids: number[];
  feature_type: string | null;
  feature_value: string | null;
  geometry: unknown;
  properties: Record<string, unknown> | null;
};

export type TileEnv = {
  DB: D1Database;
  TILES_BUCKET?: R2Bucket;
  NEON_DSN?: string;
};

export type TileDeps = {
  ensureSchema: (env: TileEnv) => Promise<void>;
  generateOsmTileData: (zoom: number, x: number, y: number) => Promise<Json>;
};

export async function handleTilesRequest(
  request: Request,
  env: TileEnv,
  ctx: ExecutionContext,
  zoom: number,
  x: number,
  y: number,
  deps: TileDeps,
): Promise<Response> {
  if (zoom !== 16) {
    return json({ error: `Zoom ${zoom} not supported` }, 404);
  }
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) {
    return json({ error: "Invalid tile coordinates" }, 400);
  }

  const cachedTile = await fetchCachedTileFromR2(env, zoom, x, y);
  if (cachedTile && hasTileFeatures(cachedTile.tile)) {
    return buildSoundscapeTileResponse(request, cachedTile.tile, "r2-hot-cache", SOUNDSCAPE_TILE_MAX_AGE_SECONDS, cachedTile.etag);
  }

  const pmtilesTile = await fetchPMTilesFromR2(env, zoom, x, y);
  if (pmtilesTile && hasTileFeatures(pmtilesTile)) {
    return buildSoundscapeTileResponse(request, pmtilesTile, "r2-pmtiles", SOUNDSCAPE_TILE_MAX_AGE_SECONDS);
  }

  try {
    const tile = await fetchTileFromNeon(env, zoom, x, y);
    if (tile && hasTileFeatures(tile)) {
      ctx.waitUntil(recordTileAccessAndMaybeCache(env, zoom, x, y, tile, deps.ensureSchema));
      return buildSoundscapeTileResponse(request, tile, "neon-postgis", 300);
    }
  } catch (err) {
    console.error(`Neon PostGIS fetch failed for tile ${zoom}/${x}/${y}:`, err);
  }

  try {
    const fallbackTile = await generateOsmSoundscapeTile(zoom, x, y, deps.generateOsmTileData);
    if (hasTileFeatures(fallbackTile)) {
      ctx.waitUntil(recordTileAccessAndMaybeCache(env, zoom, x, y, fallbackTile, deps.ensureSchema));
      return buildSoundscapeTileResponse(request, fallbackTile, "overpass-fallback", 1800);
    }
  } catch (err) {
    console.error(`Overpass fallback failed for tile ${zoom}/${x}/${y}:`, err);
  }

  const emptyTile = {
    type: "FeatureCollection",
    features: [],
    warning: "No tile data available for this region",
  } as Json;
  return buildSoundscapeTileResponse(request, emptyTile, "empty", 120);
}

class R2PMTilesSource implements Source {
  constructor(private readonly bucket: R2Bucket, private readonly key: string) {}

  getKey(): string {
    return `r2://${this.key}`;
  }

  async getBytes(offset: number, length: number, _signal?: AbortSignal, etag?: string): Promise<RangeResponse> {
    const object = await this.bucket.get(this.key, {
      onlyIf: etag ? { etagMatches: etag } : undefined,
      range: { offset, length },
    });
    if (!object) {
      throw new Error(`PMTiles archive not found: ${this.key}`);
    }

    const data = await object.arrayBuffer();
    return {
      data,
      etag: object.httpEtag,
      cacheControl: object.httpMetadata?.cacheControl,
      expires: object.httpMetadata?.cacheExpiry?.toUTCString(),
    };
  }
}

const pmtilesArchiveCache = new Map<string, PMTiles>();

function getPMTilesArchive(env: TileEnv, key: string): PMTiles | null {
  if (!env.TILES_BUCKET) {
    return null;
  }

  const cached = pmtilesArchiveCache.get(key);
  if (cached) {
    return cached;
  }

  const archive = new PMTiles(new R2PMTilesSource(env.TILES_BUCKET, key));
  pmtilesArchiveCache.set(key, archive);
  return archive;
}

async function fetchCachedTileFromR2(env: TileEnv, zoom: number, x: number, y: number): Promise<{ tile: Json; etag: string | null } | null> {
  if (!env.TILES_BUCKET) {
    return null;
  }

  const key = `tiles/${zoom}/${x}/${y}.json`;
  const object = await env.TILES_BUCKET.get(key);
  if (!object) {
    return null;
  }

  return {
    tile: (await object.json()) as Json,
    etag: object.httpEtag ?? null,
  };
}

async function fetchPMTilesFromR2(env: TileEnv, zoom: number, x: number, y: number): Promise<Json | null> {
  const archive = getPMTilesArchive(env, SOUNDSCAPE_HK_PMTILES_KEY);
  if (!archive) {
    return null;
  }

  try {
    const tile = await archive.getZxy(zoom, x, y);
    if (!tile) {
      return null;
    }

    return parseTilePayload(tile.data);
  } catch (err) {
    console.error(`R2 PMTiles fetch error for tile ${zoom}/${x}/${y}:`, err);
    return null;
  }
}

function parseTilePayload(data: ArrayBuffer): Json {
  const text = new TextDecoder().decode(new Uint8Array(data));
  return JSON.parse(text) as Json;
}

async function fetchTileFromNeon(env: TileEnv, zoom: number, x: number, y: number): Promise<Json | null> {
  const dsn = String(env.NEON_DSN || "").trim();
  if (!dsn) {
    return null;
  }

  const sql = neon(dsn, { fetchOptions: { cache: "no-store" } });
  const rows = await sql`
    SELECT type, osm_ids, feature_type, feature_value, geometry, properties
    FROM soundscape_tile(${zoom}, ${x}, ${y})
  ` as SoundscapeTileFeature[];

  const features = Array.isArray(rows)
    ? rows.map((row) => ({
        type: row.type || "Feature",
        osm_ids: Array.isArray(row.osm_ids) ? row.osm_ids : [],
        feature_type: row.feature_type || null,
        feature_value: row.feature_value || null,
        geometry: row.geometry,
        properties: row.properties || {},
      }))
    : [];

  return {
    type: "FeatureCollection",
    features,
  } as Json;
}

async function recordTileAccessAndMaybeCache(
  env: TileEnv,
  zoom: number,
  x: number,
  y: number,
  tile: Json,
  ensureSchema: (env: TileEnv) => Promise<void>,
): Promise<void> {
  await ensureSchema(env);

  const key = `${zoom}/${x}/${y}`;
  const now = nowEpoch();
  const row = await env.DB.prepare(
    `INSERT INTO tile_access (tile_key, hits, first_seen_at, last_seen_at, cached_at)
     VALUES (?1, 1, ?2, ?2, NULL)
     ON CONFLICT(tile_key) DO UPDATE SET
       hits = hits + 1,
       last_seen_at = excluded.last_seen_at
     RETURNING hits, cached_at`,
  ).bind(key, now).first<{ hits: number; cached_at: number | null }>();

  const hits = Number(row?.hits || 0);
  const cachedAt = row?.cached_at ?? null;
  if (cachedAt || hits < TILE_HOT_CACHE_THRESHOLD) {
    return;
  }

  await cacheHotTileToR2(env, zoom, x, y, tile);
  await env.DB.prepare(
    "UPDATE tile_access SET cached_at = ?2 WHERE tile_key = ?1",
  ).bind(key, now).run();
}

async function cacheHotTileToR2(env: TileEnv, zoom: number, x: number, y: number, tile: Json): Promise<void> {
  if (!env.TILES_BUCKET) {
    return;
  }

  const key = `tiles/${zoom}/${x}/${y}.json`;
  await env.TILES_BUCKET.put(key, JSON.stringify(tile), {
    httpMetadata: {
      contentType: "application/json",
      cacheControl: `public, max-age=${TILE_HOT_CACHE_TTL_SECONDS}`,
    },
  });
}

async function generateTileETag(tile: Json): Promise<string> {
  const hash = await buildCacheKey("soundscape-tile-etag-v1", tile);
  return `"${hash}"`;
}

function hasTileFeatures(tile: Json): boolean {
  const features = Array.isArray(tile.features) ? (tile.features as unknown[]) : [];
  return features.length > 0;
}

async function generateOsmSoundscapeTile(
  zoom: number,
  x: number,
  y: number,
  generateOsmTileData: (zoom: number, x: number, y: number) => Promise<Json>,
): Promise<Json> {
  const tile = await generateOsmTileData(zoom, x, y);
  const features = Array.isArray(tile.features) ? (tile.features as Json[]) : [];

  const normalized = features.map((feature) => ({
    type: String(feature.type || "Feature"),
    osm_ids: Array.isArray(feature.osm_ids) ? feature.osm_ids : [],
    feature_type: feature.feature_type ?? null,
    feature_value: feature.feature_value ?? null,
    geometry: feature.geometry ?? null,
    properties: (feature.properties as Json) || {},
  }));

  return {
    type: "FeatureCollection",
    features: normalized,
  } as Json;
}

async function buildSoundscapeTileResponse(
  request: Request,
  tile: Json,
  source: string,
  maxAgeSeconds: number,
  explicitEtag: string | null = null,
): Promise<Response> {
  const etag = explicitEtag || await generateTileETag(tile);
  const ifNoneMatch = String(request.headers.get("if-none-match") || "").trim();

  if (ifNoneMatch && ifNoneMatch === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        "Cache-Control": `public, max-age=${maxAgeSeconds}, stale-while-revalidate=${DAY}`,
        "ETag": etag,
        "Access-Control-Allow-Origin": "*",
        "X-Tile-Source": source,
      },
    });
  }

  return new Response(JSON.stringify(tile), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${maxAgeSeconds}, stale-while-revalidate=${DAY}`,
      "ETag": etag,
      "Access-Control-Allow-Origin": "*",
      "X-Tile-Source": source,
    },
  });
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
