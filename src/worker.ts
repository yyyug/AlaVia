import {
  BUILTIN_ADMIN_EMAILS,
  CACHE_MAX_AGE_SECONDS,
  CLERK_DOMAIN,
  CLERK_ISSUER,
  DAY,
  EXTERNAL_API_TIMEOUT_MS,
  GEOCODE_TTL_SECONDS,
  MAX_PAID_INTERSECTIONS,
  MAX_REQUEST_BODY_BYTES,
  OSM_CACHE_STALE_SECONDS,
  OSM_CACHE_TTL_SECONDS,
  OVERPASS_MAX_ITERATIONS,
  OVERPASS_MIN_GROWTH_RATIO,
  OVERPASS_PLACE_TIMEOUT_MS,
  OVERPASS_TIMEOUT_MS,
  PRICES,
  RATE_LIMIT_DEFAULT_PER_WINDOW,
  RATE_LIMIT_PAID_PER_WINDOW,
  RATE_LIMIT_WINDOW_SECONDS,
  TTL_365_DAYS,
  WEBHOOK_MAX_SKEW_SECONDS,
} from "./config/constants";
import {
  bearingDegrees,
  buildQueryVariants,
  haversineMeters,
  headingLabel,
  normalizeHeading,
  normalizeRoadName,
  nowEpoch,
  round4,
  round5,
  round6,
  sampleLineByMeters,
  signedBearingDelta,
} from "./lib/geo-utils";
import { buildCacheKey, getOrCreateCached, recordBilling } from "./services/cache";
import {
  enforceGatewayPolicies as applyGatewayPolicies,
  enforceRateLimit as applyRateLimit,
} from "./services/gateway-policy";
import { dispatchRoute } from "./services/http-router";
import { ensureD1Schema } from "./services/schema";
import { handleTilesRequest as handleTilesRequestFromService } from "./services/tiles";

export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  CACHE_BUCKET: R2Bucket;
  TILES_BUCKET?: R2Bucket;
  GOOGLE_MAPS_API_KEY?: string;
  GEMINI_API_KEY?: string;
  ALLOWED_ACCESS_EMAILS?: string;
  CLERK_SECRET_KEY?: string;
  CLERK_WEBHOOK_SECRET?: string;
  CLERK_JWT_AUDIENCE?: string;
  ALLOW_DEV_BYPASS?: string;
  NEON_DSN?: string;
}

type Json = Record<string, unknown>;
type ClerkJwtPayload = {
  sub: string;
  exp: number;
  iss?: string;
  aud?: string | string[];
  nbf?: number;
  iat?: number;
};
type TurnCandidate = {
  roadName: string;
  bearing: number;
  direction: string;
  delta: number;
};

type IntersectionRow = {
  id: number;
  lat: number;
  lon: number;
  name: string;
  crossStreets: string[];
  type: string;
  bearingToNext: number | null;
  directionToNext: string | null;
  distanceToNext: number;
  addressLabel: string | null;
  addressSource: string | null;
  leftTurn: TurnCandidate | null;
  rightTurn: TurnCandidate | null;
};
type OsmPlaceCandidate = {
  id: string;
  lat: number;
  lon: number;
  title: string;
  addressLabel: string | null;
  kindLabel: string | null;
  streetName: string | null;
  distanceMeters: number;
  sortMeters: number;
  distanceToLineMeters: number;
  onTargetRoad: boolean;
  hasHouseNumber: boolean;
  hasExplicitName: boolean;
  hasFeatureTag: boolean;
};

type GeocodedAddress = {
  lat: number;
  lon: number;
  streetName: string | null;
  subThoroughfare: string | null;
  addressLine: string | null;
};

type OsmCoverageAssessment = {
  onRoadAddressCount: number;
  onRoadNamedCount: number;
  totalCount: number;
  likelyCommercialUnnamed: boolean;
  shouldFallback: boolean;
  reason: string;
};

type GoogleRoutePlaceCandidate = {
  id: string;
  title: string;
  typeLabel: string | null;
  addressLabel: string | null;
  lat: number;
  lon: number;
  sortMeters: number;
  distanceToLineMeters: number;
};

// ── Indoor Navigation Types ────────────────────────────────────────────────
type StreetViewLink = {
  panoId: string;
  heading: number;
  description: string;
  label?: string;
};

type PanoNode = {
  panoId: string;
  lat: number;
  lon: number;
  levelLabel?: string | null;
  links: StreetViewLink[];
  copyright?: string | null;
  date?: string | null;
  isIndoor: boolean;
  providerHint?: string | null;
};

type LinkAnalysisResult = {
  panoId: string;
  heading: number;
  description: string;
  label: string;
  cvAnalysis?: {
    feature?: string; // 楼梯、电梯、通道、剪票口等
    confidence?: number;
  };
};

type IndoorStepDecision = {
  mode: "link" | "offset" | "manual";
  confidence: number;
  confidenceLevel: "high" | "medium" | "low";
  fallbackToManual: boolean;
  reason: string;
  selectedLink?: {
    panoId: string;
    heading: number;
    description: string;
    label: string;
    delta: number;
  };
  target?: { lat: number; lon: number };
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;

    if (url.pathname.startsWith("/api/") && url.pathname !== "/api/clerk/webhook") {
      try {
        await applyGatewayPolicies(request, env, url.pathname, () => ensureD1Schema(env));
      } catch (err) {
        return withErrorHandling(async () => {
          throw err;
        });
      }
    }

    const routed = await dispatchRoute(url.pathname, method, [
      { pathname: "/api/geocode/autobbox", method: "POST", handler: () => withErrorHandling(() => handleGeocodeAutoBbox(request)) },
      { pathname: "/api/geocode/reverse-road", method: "POST", handler: () => withErrorHandling(() => handleGeocodeReverseRoad(request, env, ctx)) },
      { pathname: "/api/overpass/segment", method: "POST", handler: () => withErrorHandling(() => handleOverpassSegment(request, env, ctx)) },
      { pathname: "/api/intersections/near", method: "POST", handler: () => withErrorHandling(() => handleIntersectionsNear(request, env, ctx)) },
      { pathname: "/api/osm/tile", method: "POST", handler: () => withErrorHandling(() => handleOsmTile(request, env, ctx)) },
      { pathname: "/api/osm/scan-nearby", method: "POST", handler: () => withErrorHandling(() => handleOsmScanNearby(request, env, ctx)) },
      { pathname: "/api/osm/places-around", method: "POST", handler: () => withErrorHandling(() => handleOsmPlacesAround(request, env, ctx)) },
      { pathname: "/api/paid/places", method: "POST", handler: () => withErrorHandling(() => handlePaidPlaces(request, env, ctx)) },
      { pathname: "/api/paid/streetview", method: "POST", handler: () => withErrorHandling(() => handlePaidStreetView(request, env, ctx)) },
      { pathname: "/api/paid/streetview/panorama-describe", method: "POST", handler: () => withErrorHandling(() => handlePaidStreetViewPanoramaDescribe(request, env)) },
      { pathname: "/api/streetview/metadata", method: "POST", handler: () => withErrorHandling(() => handleStreetViewMetadata(request, env)) },
      { pathname: "/api/streetview/resolve-pano", method: "POST", handler: () => withErrorHandling(() => handleResolveStreetViewPano(request, env)) },
      { pathname: "/api/streetview/find-indoor-entry", method: "POST", handler: () => withErrorHandling(() => handleFindNearbyIndoorEntry(request, env, ctx)) },
      { pathname: "/api/streetview/indoor-step", method: "POST", handler: () => withErrorHandling(() => handleIndoorStepDecision(request)) },
      { pathname: "/api/streetview/analyze-link", method: "POST", handler: () => withErrorHandling(() => handleAnalyzeStreetViewLink(request, env, ctx)) },
      { pathname: "/api/config/maps-key", method: "POST", handler: () => withErrorHandling(() => handleGetMapsKey(request, env)) },
      { pathname: "/api/admin/cleanup-noimage", method: "POST", handler: () => withErrorHandling(() => handleCleanupNoImage(request, env)) },
      { pathname: "/api/admin/streetview-storage", method: "POST", handler: () => withErrorHandling(() => handleStreetViewStorageReport(request, env)) },
      { pathname: "/api/paid/route-scenery", method: "POST", handler: () => withErrorHandling(() => handlePaidRouteScenery(request, env, ctx)) },
      { pathname: "/api/osm/route-places", method: "POST", handler: () => withErrorHandling(() => handleOsmRoutePlaces(request, env, ctx)) },
      { pathname: "/api/google/route-places", method: "POST", handler: () => withErrorHandling(() => handleGoogleRoutePlaces(request, env, ctx)) },
      { pathname: "/api/intersections/address-batch", method: "POST", handler: () => withErrorHandling(() => handleIntersectionAddressBatch(request, env, ctx)) },
      { pathname: "/api/me", method: "GET", handler: () => withErrorHandling(() => handleMe(request, env)) },
      { pathname: "/api/billing/summary", method: "GET", handler: () => withErrorHandling(() => handleBillingSummary(request, env)) },
      { pathname: "/api/admin/users", method: "GET", handler: () => withErrorHandling(() => handleAdminListUsers(request, env)) },
      { pathname: "/api/admin/billing-summary", method: "GET", handler: () => withErrorHandling(() => handleAdminBillingSummary(request, env)) },
      { pathname: "/api/admin/approve-user", method: "POST", handler: () => withErrorHandling(() => handleAdminApproveUser(request, env)) },
      { pathname: "/api/admin/cache-stats", method: "GET", handler: () => withErrorHandling(() => handleAdminCacheStats(request, env)) },
      { pathname: "/api/admin/cache-purge-expired", method: "POST", handler: () => withErrorHandling(() => handleAdminCachePurgeExpired(request, env)) },
      { pathname: "/api/admin/cache-streets", method: "GET", handler: () => withErrorHandling(() => handleAdminCacheStreets(request, env)) },
      { pathname: "/api/clerk/webhook", method: "POST", handler: () => withErrorHandling(() => handleClerkWebhook(request, env)) },
    ]);

    if (routed) {
      return routed;
    }

    // ── SoundScape Tiles Routes ──────────────────────────────────────────
    const tilesMatch = /^\/tiles\/(\d+)\/(\d+)\/(\d+)\.json$/.exec(url.pathname);
    if (tilesMatch && method === "GET") {
      const zoom = parseInt(tilesMatch[1], 10);
      const x = parseInt(tilesMatch[2], 10);
      const y = parseInt(tilesMatch[3], 10);
      return withErrorHandling(() => handleTilesRequestFromService(request, env, ctx, zoom, x, y, {
        ensureSchema: ensureD1Schema,
        generateOsmTileData,
      }));
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
  const edgeHit = await getEdgeCache().match(edgeReq);
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
    // Try multiple query variants for better CJK compatibility
    const queryVariants = buildQueryVariants(query);
    for (const q of queryVariants) {
      const filteredItems = await fetchNominatimSearch(q, normalizedCountry);
      if (filteredItems.length > 0) {
        items = filteredItems;
        resolvedCountryCode = normalizedCountry;
        break;
      }
    }
    // Fallback: try without country filter
    if (!items.length) {
      for (const q of queryVariants) {
        const anyItems = await fetchNominatimSearch(q, "");
        if (anyItems.length > 0) {
          items = anyItems;
          resolvedCountryCode = normalizedCountry;
          break;
        }
      }
    }
  } else {
    items = await fetchNominatimSearch(query, "");
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error(`Geocode no result for query "${query}" (country: ${countryCode || "any"})`);
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
    roadName: extractRoadNameFromGeocodeRecord(first, query),
    lat: Number(first.lat),
    lon: Number(first.lon),
    bbox: {
      south,
      west,
      north,
      east,
    },
  };

  await getEdgeCache().put(
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

async function handleGeocodeReverseRoad(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await requireJson(request);
  const lat = Number(body.lat);
  const lon = Number(body.lon);
  validateCoordinates(lat, lon);

  const reverse = await fetchNominatimReverse(env, lat, lon, ctx);
  const roadName = extractRoadNameFromGeocodeRecord(reverse, "");
  if (!roadName) {
    throw new Error("Reverse geocode road not found");
  }

  const address = ((reverse.address || {}) as Json);
  const houseNumber = String(address.house_number || "").trim();
  
  return json({
    ok: true,
    lat: round6(lat),
    lon: round6(lon),
    roadName,
    displayName: String(reverse.display_name || roadName),
    country: String(address.country || "").trim(),
    countryCode: String(address.country_code || "").trim().toUpperCase() || null,
    houseNumber: houseNumber || null,
    streetName: roadName || null,
  });
}

function extractRoadNameFromGeocodeRecord(record: Record<string, unknown>, fallback: string): string {
  const address = ((record.address || {}) as Json);
  const candidates = [
    address.road,
    address.pedestrian,
    address.highway,
    address.residential,
    address.footway,
    address.path,
    address.cycleway,
    record.name,
    String(record.display_name || "").split(",")[0],
    fallback,
  ];

  for (const raw of candidates) {
    const value = String(raw || "").trim();
    if (value) {
      return value;
    }
  }

  return "";
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = EXTERNAL_API_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort("fetch-timeout"), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function validateCoordinates(lat: number, lon: number): void {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error("Coordinates must be valid numbers");
  }
  if (lat < -90 || lat > 90) {
    throw new Error("Latitude must be between -90 and 90");
  }
  if (lon < -180 || lon > 180) {
    throw new Error("Longitude must be between -180 and 180");
  }
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
  const res = await fetchWithTimeout(url, {
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

async function handleOverpassSegment(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await requireJson(request);
  const roadName = String(body.roadName || "").trim();
  const countryCode = String(body.countryCode || "").trim().toLowerCase();
  const focusLat = body.focusLat !== undefined ? Number(body.focusLat) : null;
  const focusLon = body.focusLon !== undefined ? Number(body.focusLon) : null;
  if (!roadName) {
    throw new Error("roadName is required");
  }
  const focusPoint = (focusLat !== null && focusLon !== null && Number.isFinite(focusLat) && Number.isFinite(focusLon))
    ? { lat: focusLat, lon: focusLon }
    : undefined;
  const data = await fetchSegmentData(env, ctx, roadName, countryCode, focusPoint);
  return json(data);
}

// Combined endpoint: reverse-geocode lat/lon then return segment intersections in one round-trip.
// Saves the iOS client from making two sequential calls (reverseRoad + overpassSegment).
async function handleIntersectionsNear(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await requireJson(request);
  const lat = Number(body.lat);
  const lon = Number(body.lon);
  const countryCode = String(body.countryCode || "").trim().toLowerCase();
  validateCoordinates(lat, lon);

  const reverse = await fetchNominatimReverse(env, lat, lon, ctx);
  const roadName = extractRoadNameFromGeocodeRecord(reverse, "");
  if (!roadName) {
    throw new Error("Could not determine road from coordinates");
  }

  const address = (reverse.address || {}) as Record<string, unknown>;
  const resolvedCountry = countryCode || String(address.country_code || "").trim().toLowerCase();

  const segmentData = await fetchSegmentData(env, ctx, roadName, resolvedCountry);
  return json({
    ...(segmentData as object),
    lat: round6(lat),
    lon: round6(lon),
    displayName: String(reverse.display_name || roadName),
    resolvedRoadName: roadName,
  });
}


async function fetchSegmentData(
  env: Env,
  ctx: ExecutionContext,
  roadName: string,
  countryCode: string,
  focusPoint?: { lat: number; lon: number },
): Promise<Json> {
  await ensureD1Schema(env);
  // Cache key uses only normalized road name — no bbox — so repeated queries for
  // the same road always hit the same cache entry regardless of Nominatim variance.
  const cachePayload = {
    roadName: normalizeRoadName(roadName),
    countryCode,
    version: 5,
  };

  const cached = await getOrCreateCached(
    env,
    "osm-segment-v2",
    cachePayload,
    async () => {
      // Nominatim + Overpass are only called on a true cache miss.
      // Use the client-provided focusPoint if available to skip the extra Nominatim call.
      const geo = await resolveRoadBBox(roadName, countryCode, focusPoint);
      const south = geo.bbox.south;
      const west = geo.bbox.west;
      const north = geo.bbox.north;
      const east = geo.bbox.east;

      if (![south, west, north, east].every(Number.isFinite)) {
        throw new Error("Could not resolve a valid bbox");
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

      for (let i = 1; i <= OVERPASS_MAX_ITERATIONS; i += 1) {
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

        if (i > 1) {
          const previousCount = previousMatchedIds.size;
          const currentCount = matchedIds.size;
          const growthCount = currentCount - previousCount;
          if (growthCount <= 0) {
            stabilizedReason = "matched_ways_non_increasing";
            break;
          }
          const growthRatio = growthCount / Math.max(1, previousCount);
          if (growthRatio < OVERPASS_MIN_GROWTH_RATIO) {
            stabilizedReason = "matched_ways_growth_below_threshold";
            break;
          }
        }

        const expansion = expandBBoxByConnectivity(currentBbox, targetWays, parsed.nodes, 0.8, 0.8);
        if (!expansion.changed) {
          stabilizedReason = expansion.clamped ? "bbox_clamped" : "connectivity_bounds_stable";
          break;
        }

        previousMatchedIds = matchedIds;
        currentBbox = expansion.bbox;

        if (i === OVERPASS_MAX_ITERATIONS) {
          stabilizedReason = "max_iterations_reached";
        }
      }

      if (!overpassResult || !parsed) {
        throw new Error("Overpass query failed");
      }

      const nodes = parsed.nodes;
      const targetWayIds = new Set(targetWays.map((way) => way.id));
      const primaryRoadName = pickPrimaryRoadName(targetWays, roadName);

      if (!targetWays.length) {
        return {
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
        } as Json;
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
      const intersectionsRaw: Array<{
        id: number;
        lat: number;
        lon: number;
        name: string;
        crossStreets: string[];
        type: string;
        crossBearingOptions: Array<{ roadName: string; bearing: number }>;
      }> = [];

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
          .filter((w) => !targetWayIds.has(w.id) && shouldIncludeIntersectionCrossWay(w))
          .map((w) => String(w.tags["name:zh"] || w.tags.name || ""))
          .map((n) => n.trim())
          .filter((n) => n && normalizeRoadName(n) !== normalizeRoadName(primaryRoadName));

        const crossBearingOptions = linkedWays
          .filter((w) => !targetWayIds.has(w.id) && shouldIncludeIntersectionCrossWay(w))
          .flatMap((w) => {
            const roadName = String(w.tags["name:zh"] || w.tags.name || "").trim();
            if (!roadName || normalizeRoadName(roadName) === normalizeRoadName(primaryRoadName)) {
              return [];
            }
            return getWayDepartureBearings(w, nid, nodes).map((bearing) => ({ roadName, bearing }));
          });

        const uniqueCross = [...new Set(crossNames)];
        const baseName = String(node.tags["name:zh"] || node.tags.name || "").trim();
        const intersectionName =
          baseName || `${primaryRoadName} × ${uniqueCross[0] || "未命名道路"}`;

        intersectionsRaw.push({
          id: nid,
          lat: node.lat,
          lon: node.lon,
          name: intersectionName,
          crossStreets: uniqueCross,
          type: classifyIntersection(linkedWays.length),
          crossBearingOptions,
        });
      }

      const unique = dedupeIntersections(intersectionsRaw);
      const intersections = unique.map((cur, index) => {
        const prev = unique[index - 1];
        const next = unique[index + 1];
        const forwardBearing = next
          ? bearingDegrees(cur, next)
          : prev
            ? normalizeHeading(bearingDegrees(prev, cur))
            : null;
        const turnCandidates = resolveTurnCandidates(cur.crossBearingOptions, forwardBearing);

        if (!next) {
          return {
            ...cur,
            bearingToNext: null,
            directionToNext: null,
            distanceToNext: 0,
            leftTurn: turnCandidates.left,
            rightTurn: turnCandidates.right,
          };
        }

        const bearing = bearingDegrees(cur, next);
        return {
          ...cur,
          bearingToNext: Math.round(bearing),
          directionToNext: headingLabel(bearing),
          distanceToNext: Math.round(haversineMeters(cur, next)),
          leftTurn: turnCandidates.left,
          rightTurn: turnCandidates.right,
        };
      });

      let totalLengthMeters = 0;
      for (let i = 0; i < intersections.length - 1; i += 1) {
        totalLengthMeters += Number(intersections[i].distanceToNext || 0);
      }

      const warning = intersections.length === 0
        ? "Overpass 有回傳道路資料，但目前條件下沒有可辨識路口。請放大 bbox 或改用更完整路段名稱。"
        : null;

      return {
        roadName: primaryRoadName,
        queryRoadName: roadName,
        totalLengthMeters,
        intersections: intersections.map((row) => ({
          ...row,
          addressLabel: null,
          addressSource: null,
        })),
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
      } as Json;
    },
    OSM_CACHE_TTL_SECONDS,
    {
      ctx,
      staleWhileRevalidateSeconds: OSM_CACHE_STALE_SECONDS,
    },
  );

  return cached.data;
}

async function handleOsmTile(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await requireJson(request);
  const zoom = Number(body.zoom ?? 16);
  const x = Number(body.x);
  const y = Number(body.y);

  if (!Number.isInteger(zoom) || !Number.isInteger(x) || !Number.isInteger(y)) {
    throw new Error("zoom, x, y must be integers");
  }
  if (zoom !== 16) {
    throw new Error("Only zoom 16 is supported currently");
  }

  const tile = await getOrCreateOsmTile(env, ctx, zoom, x, y);
  return json({ ok: true, ...tile });
}

async function handleOsmScanNearby(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await requireJson(request);
  const lat = Number(body.lat);
  const lon = Number(body.lon);
  const radiusMeters = Math.max(100, Math.min(2500, Number(body.radiusMeters ?? 1000)));
  const zoom = Number(body.zoom ?? 16);

  validateCoordinates(lat, lon);
  if (!Number.isInteger(zoom) || zoom !== 16) {
    throw new Error("Only zoom 16 is supported currently");
  }

  const latPad = metersToLatDegrees(radiusMeters);
  const lonPad = metersToLonDegrees(radiusMeters, lat);
  const south = lat - latPad;
  const north = lat + latPad;
  const west = lon - lonPad;
  const east = lon + lonPad;

  const min = lonLatToTileXY(north, west, zoom);
  const max = lonLatToTileXY(south, east, zoom);

  const tiles: Array<{ x: number; y: number }> = [];
  for (let ty = Math.min(min.y, max.y); ty <= Math.max(min.y, max.y); ty += 1) {
    for (let tx = Math.min(min.x, max.x); tx <= Math.max(min.x, max.x); tx += 1) {
      tiles.push({ x: tx, y: ty });
    }
  }

  const cappedTiles = tiles.slice(0, 64);
  await Promise.all(cappedTiles.map((tile) => getOrCreateOsmTile(env, ctx, zoom, tile.x, tile.y)));

  return json({
    ok: true,
    zoom,
    lat: round6(lat),
    lon: round6(lon),
    radiusMeters,
    scannedTiles: cappedTiles.length,
    tiles: cappedTiles,
  });
}

async function getOrCreateOsmTile(
  env: Env,
  ctx: ExecutionContext,
  zoom: number,
  x: number,
  y: number,
): Promise<Json> {
  const cached = await getOrCreateCached(
    env,
    "osm-tile-v1",
    { zoom, x, y, version: 1 },
    async () => generateOsmTileData(zoom, x, y),
    OSM_CACHE_TTL_SECONDS,
    {
      ctx,
      staleWhileRevalidateSeconds: OSM_CACHE_STALE_SECONDS,
    },
  );
  return cached.data;
}

async function generateOsmTileData(zoom: number, x: number, y: number): Promise<Json> {
  const bbox = tileXYToBBox(zoom, x, y);
  const overpassResult = await fetchOverpassPlaceJson(buildOsmTileQuery(bbox));
  const parsed = parseOverpassData(overpassResult.data);
  const features = buildTileFeatures(parsed, bbox);
  return {
    zoom,
    x,
    y,
    bbox,
    endpoint: overpassResult.endpoint,
    featureCount: features.length,
    type: "FeatureCollection",
    features,
  } as Json;
}

function buildOsmTileQuery(bbox: BBox): string {
  return `
[out:json][timeout:25];
(
  way["highway"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  node["highway"="crossing"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  node["entrance"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  node["amenity"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  node["shop"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  node["tourism"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  way["building"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
);
out body geom;
`;
}

function buildTileFeatures(parsed: ParsedOverpass, bbox: BBox): Json[] {
  const features: Json[] = [];

  // Collect all entrance nodes for later grouping with buildings
  const entranceNodes = new Map<number, { id: number; lat: number; lon: number; tags: Json }>();
  for (const node of parsed.nodes.values()) {
    if (node.tags.entrance) {
      entranceNodes.set(node.id, node);
    }
  }

  // Process POI nodes (exclude entrance nodes, which will be grouped into gd_entrance_list)
  for (const node of parsed.nodes.values()) {
    if (node.tags.entrance) {
      continue; // Skip individual entrance nodes
    }
    if (!hasInterestingTileTags(node.tags)) {
      continue;
    }
    const featureType = tileFeatureTypeForTags(node.tags);
    const name = String(node.tags.name || node.tags["name:zh"] || node.tags.amenity || node.tags.shop || node.tags.tourism || "yes");
    features.push({
      type: "Feature",
      osm_ids: [node.id],
      feature_type: featureType,
      feature_value: name,
      geometry: { type: "Point", coordinates: [round6(node.lon), round6(node.lat)] },
      properties: node.tags,
    } as Json);
  }

  // Process road ways
  const roadWays = parsed.ways.filter((way) => String(way.tags.highway || "").trim().length > 0);
  for (const way of roadWays) {
    const coords = way.nodes
      .map((id) => parsed.nodes.get(id))
      .filter(Boolean)
      .map((n) => [round6((n as { lon: number }).lon), round6((n as { lat: number }).lat)]);
    if (coords.length < 2) {
      continue;
    }
    features.push({
      type: "Feature",
      osm_ids: [way.id],
      feature_type: "highway",
      feature_value: String(way.tags.highway || "road"),
      geometry: { type: "LineString", coordinates: coords },
      properties: way.tags,
    } as Json);
  }

  // Process building ways
  const buildingWays = parsed.ways.filter((way) => String(way.tags.building || "").trim().length > 0);
  for (const way of buildingWays) {
    const coords = way.nodes
      .map((id) => parsed.nodes.get(id))
      .filter(Boolean)
      .map((n) => [round6((n as { lon: number }).lon), round6((n as { lat: number }).lat)]);
    if (coords.length < 3) {
      continue;
    }
    const isClosed = coords.length > 3 && coords[0][0] === coords[coords.length - 1][0] && coords[0][1] === coords[coords.length - 1][1];
    
    // Generate building name
    const buildingName = String(way.tags["name:zh"] || way.tags.name || way.tags.building || "building");
    
    features.push({
      type: "Feature",
      osm_ids: [way.id],
      feature_type: "building",
      feature_value: buildingName,
      geometry: isClosed
        ? { type: "Polygon", coordinates: [coords] }
        : { type: "LineString", coordinates: coords },
      properties: way.tags,
    } as Json);

    // Create gd_entrance_list for buildings with nearby entrances
    if (entranceNodes.size > 0) {
      const buildingEntrances = findNearbyEntrances(way.nodes, parsed.nodes, entranceNodes, 0.0001); // ~10m at equator
      if (buildingEntrances.length > 0) {
        const entranceCoords = buildingEntrances.map((e) => [round6(e.lon), round6(e.lat)]);
        const osmIds = [way.id, ...buildingEntrances.map((e) => e.id)];
        features.push({
          type: "Feature",
          osm_ids: osmIds,
          feature_type: "gd_entrance_list",
          feature_value: "yes",
          geometry: buildingEntrances.length === 1
            ? { type: "Point", coordinates: entranceCoords[0] }
            : { type: "MultiPoint", coordinates: entranceCoords },
          properties: {},
        } as Json);
      }
    }
  }

  // Calculate road intersections
  const nodeUsage = new Map<number, number>();
  const nodeToWayIds = new Map<number, Set<number>>();
  for (const way of roadWays) {
    for (const nid of way.nodes) {
      nodeUsage.set(nid, (nodeUsage.get(nid) || 0) + 1);
      if (!nodeToWayIds.has(nid)) {
        nodeToWayIds.set(nid, new Set<number>());
      }
      nodeToWayIds.get(nid)!.add(way.id);
    }
  }
  for (const [nid, count] of nodeUsage) {
    if (count <= 1) {
      continue;
    }
    const node = parsed.nodes.get(nid);
    if (!node) {
      continue;
    }
    if (node.lat < bbox.south || node.lat > bbox.north || node.lon < bbox.west || node.lon > bbox.east) {
      continue;
    }
    const wayIds = Array.from(nodeToWayIds.get(nid) ?? []).sort((a, b) => a - b);
    if (wayIds.length <= 1) {
      continue;
    }
    features.push({
      type: "Feature",
      osm_ids: wayIds,
      feature_type: "highway",
      feature_value: "gd_intersection",
      geometry: { type: "Point", coordinates: [round6(node.lon), round6(node.lat)] },
      properties: {},
    } as Json);
  }

  return features;
}

function findNearbyEntrances(
  buildingNodeIds: number[],
  nodes: Map<number, { id: number; lat: number; lon: number; tags: Json }>,
  entranceNodes: Map<number, { id: number; lat: number; lon: number; tags: Json }>,
  proximityThreshold: number,
): { id: number; lat: number; lon: number }[] {
  const buildingCoords = buildingNodeIds
    .map((id) => nodes.get(id))
    .filter(Boolean)
    .map((n) => ({ lat: (n as any).lat, lon: (n as any).lon }));

  if (buildingCoords.length === 0) {
    return [];
  }

  // Calculate building centroid
  const centroidLat = buildingCoords.reduce((sum, c) => sum + c.lat, 0) / buildingCoords.length;
  const centroidLon = buildingCoords.reduce((sum, c) => sum + c.lon, 0) / buildingCoords.length;

  // Find entrances within proximity threshold
  const nearby: { id: number; lat: number; lon: number }[] = [];
  for (const entrance of entranceNodes.values()) {
    const latDiff = Math.abs(entrance.lat - centroidLat);
    const lonDiff = Math.abs(entrance.lon - centroidLon);
    if (latDiff < proximityThreshold && lonDiff < proximityThreshold) {
      nearby.push({ id: entrance.id, lat: entrance.lat, lon: entrance.lon });
    }
  }
  return nearby;
}

function hasInterestingTileTags(tags: Json): boolean {
  return Boolean(
    tags.amenity || tags.shop || tags.tourism ||
    tags["public_transport"] || tags.railway || tags.highway === "crossing",
  );
}

function tileFeatureTypeForTags(tags: Json): string {
  if (tags.amenity || tags.shop || tags.tourism) return "place";
  if (tags.railway || tags["public_transport"]) return "transit";
  if (tags.highway === "crossing") return "crossing";
  return "place";
}

function lonLatToTileXY(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom;
  const latRad = (lat * Math.PI) / 180;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x, y };
}

function tileXToLon(x: number, zoom: number): number {
  return (x / (2 ** zoom)) * 360 - 180;
}

function tileYToLat(y: number, zoom: number): number {
  const n = Math.PI - (2 * Math.PI * y) / (2 ** zoom);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function tileXYToBBox(zoom: number, x: number, y: number): BBox {
  const north = tileYToLat(y, zoom);
  const south = tileYToLat(y + 1, zoom);
  const west = tileXToLon(x, zoom);
  const east = tileXToLon(x + 1, zoom);
  return { south, west, north, east };
}

async function fetchOverpassJson(query: string): Promise<{ data: Json; endpoint: string }> {
  return fetchOverpassJsonWithEndpoints(
    query,
    [
      "https://overpass-api.de/api/interpreter",
      "https://overpass.kumi.systems/api/interpreter",
      "https://overpass.openstreetmap.fr/api/interpreter",
    ],
    OVERPASS_TIMEOUT_MS,
  );
}

async function fetchOverpassPlaceJson(query: string): Promise<{ data: Json; endpoint: string }> {
  return fetchOverpassJsonWithEndpoints(
    query,
    [
      "https://overpass-api.de/api/interpreter",
      "https://overpass.kumi.systems/api/interpreter",
      "https://overpass.openstreetmap.fr/api/interpreter",
    ],
    OVERPASS_PLACE_TIMEOUT_MS,
  );
}

async function fetchOverpassJsonWithEndpoints(
  query: string,
  endpoints: string[],
  timeoutMs: number,
): Promise<{ data: Json; endpoint: string }> {
  let lastStatus = 0;
  for (const base of endpoints) {
    const url = `${base}?data=${encodeURIComponent(query)}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort("overpass-timeout"), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "GET",
        signal: controller.signal,
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
    } catch {
      lastStatus = 598;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw new Error(`Overpass error: ${lastStatus}`);
}

async function fetchNominatimReverse(env: Env, lat: number, lon: number, ctx?: ExecutionContext): Promise<Json> {
  const payload = { lat: round6(lat), lon: round6(lon) };
  const cached = await getOrCreateCached(
    env,
    "geocode-reverse-v2",
    payload,
    async () => {
      const p = new URLSearchParams({
        lat: String(payload.lat),
        lon: String(payload.lon),
        format: "jsonv2",
        addressdetails: "1",
        zoom: "18",
      });

      const url = `https://nominatim.openstreetmap.org/reverse?${p.toString()}`;
      const res = await fetchWithTimeout(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          "user-agent": "AlaViaBlindMap/0.1 (contact: yoofun@gmail.com)",
        },
      });
      if (!res.ok) {
        throw new Error(`Reverse geocode error: ${res.status}`);
      }

      return (await res.json()) as Json;
    },
    TTL_365_DAYS,
    {
      ctx,
      staleWhileRevalidateSeconds: 30 * DAY,
    },
  );

  return cached.data;
}

async function handleOsmRoutePlaces(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await requireJson(request);
  const start = body.start as Json;
  const end = body.end as Json;
  const roadName = String(body.roadName || "").trim();

  const startPoint = { lat: Number(start.lat), lon: Number(start.lon) };
  const endPoint = { lat: Number(end.lat), lon: Number(end.lon) };

  if (![startPoint.lat, startPoint.lon, endPoint.lat, endPoint.lon].every(Number.isFinite)) {
    throw new Error("start and end coordinates are required");
  }

  const canonicalSegment = canonicalizeRouteSegment(startPoint, endPoint);

  await ensureD1Schema(env);
  const cachePayload = {
    roadName: normalizeRoadName(roadName),
    start: { lat: canonicalSegment.start.lat, lon: canonicalSegment.start.lon },
    end: { lat: canonicalSegment.end.lat, lon: canonicalSegment.end.lon },
    version: 3,
  };

  const cached = await getOrCreateCached(
    env,
    "osm-route-places-v2",
    cachePayload,
    async () => {
      const bbox = expandBBoxAroundSegment(canonicalSegment.start, canonicalSegment.end, 38);
      const overpassResult = await fetchOverpassPlaceJson(buildOsmBBoxPlaceQuery(bbox));
      const segmentLength = haversineMeters(canonicalSegment.start, canonicalSegment.end);
      const maxOffset = Math.max(30, Math.min(60, segmentLength / 3));

      const candidates = dedupeOsmPlaces(
        parseOsmPlaceCandidates(overpassResult.data).map((place) => {
          const projection = projectPointToSegmentMeters(canonicalSegment.start, canonicalSegment.end, place);
          return {
            ...place,
            distanceMeters: Math.round(projection.alongMeters),
            sortMeters: Math.round(projection.alongMeters),
            distanceToLineMeters: Math.round(projection.distanceToLineMeters),
            onTargetRoad: roadName ? isTargetRoadPlace(place.streetName, roadName) : place.onTargetRoad,
          };
        }),
      ).filter((place) => place.distanceToLineMeters <= maxOffset);

      const places = prioritizeRoutePlaces(candidates).slice(0, 16);
      const osmAssessment = assessOsmCoverage(places, candidates);

      const lines = places.length
        ? places.map((place) => `${Math.max(0, place.sortMeters)}m：${formatOsmPlaceLine(place, false)}`)
        : ["未找到可排序的沿街樓宇/地點，可能是此段 OSM 門牌或名稱資料不足。"];

      const notes = [
        `OSM 篩選：主路門牌 ${osmAssessment.onRoadAddressCount} 個，主路命名地點 ${osmAssessment.onRoadNamedCount} 個，旁支候選已收斂。`,
      ];

      const text = [
        `沿街 OSM 地點整理完成，共 ${places.length} 個候選點。`,
        `來源：${overpassResult.endpoint}`,
        ...notes,
        "",
        ...lines,
      ].join("\n");

      return {
        ok: true,
        provider: "osm-route-places",
        endpoint: overpassResult.endpoint,
        count: places.length,
        googleFallbackCount: 0,
        googleFallbackReason: null,
        text,
        places,
        googlePlaces: [],
      } as Json;
    },
    OSM_CACHE_TTL_SECONDS,
    {
      ctx,
      staleWhileRevalidateSeconds: OSM_CACHE_STALE_SECONDS,
    },
  );

  return json(adaptOsmRoutePlacesForDirection(cached.data, canonicalSegment));
}

async function handleOsmPlacesAround(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await requireJson(request);
  const lat = Number(body.lat);
  const lon = Number(body.lon);
  const radiusMeters = Math.max(30, Math.min(300, Number(body.radiusMeters ?? 120)));
  validateCoordinates(lat, lon);

  const origin = { lat: round6(lat), lon: round6(lon) };
  const cachePayload = {
    lat: origin.lat,
    lon: origin.lon,
    radiusMeters: Math.round(radiusMeters),
    version: 1,
  };

  const cached = await getOrCreateCached(
    env,
    "osm-places-around-v1",
    cachePayload,
    async () => {
      const overpassResult = await fetchOverpassPlaceJson(buildOsmAroundPlaceQuery(origin.lat, origin.lon, radiusMeters));
      const candidates = dedupeOsmPlaces(parseOsmPlaceCandidates(overpassResult.data));

      const places = candidates
        .map((place) => {
          const distanceMeters = Math.round(haversineMeters(origin, place));
          const bearing = Math.round(normalizeHeading(bearingDegrees(origin, place)));
          return {
            id: place.id,
            title: place.title,
            kindLabel: place.kindLabel,
            addressLabel: place.addressLabel,
            lat: round6(place.lat),
            lon: round6(place.lon),
            distanceMeters,
            bearing,
            direction: headingLabel(bearing),
            hasExplicitName: place.hasExplicitName,
            hasFeatureTag: place.hasFeatureTag,
          };
        })
        .sort((a, b) => {
          const aScore = a.distanceMeters + (a.hasExplicitName ? 0 : 20) + (a.hasFeatureTag ? 0 : 10);
          const bScore = b.distanceMeters + (b.hasExplicitName ? 0 : 20) + (b.hasFeatureTag ? 0 : 10);
          return aScore - bScore || a.distanceMeters - b.distanceMeters;
        })
        .slice(0, 24);

      return {
        ok: true,
        provider: "osm-places-around",
        endpoint: overpassResult.endpoint,
        count: places.length,
        lat: origin.lat,
        lon: origin.lon,
        radiusMeters: Math.round(radiusMeters),
        places,
      } as Json;
    },
    OSM_CACHE_TTL_SECONDS,
    {
      ctx,
      staleWhileRevalidateSeconds: OSM_CACHE_STALE_SECONDS,
    },
  );

  return json(cached.data);
}

function canonicalizeRouteSegment(
  start: { lat: number; lon: number },
  end: { lat: number; lon: number },
): { start: { lat: number; lon: number }; end: { lat: number; lon: number }; reversed: boolean } {
  const a = { lat: round4(start.lat), lon: round4(start.lon) };
  const b = { lat: round4(end.lat), lon: round4(end.lon) };
  const keepOrder = a.lat < b.lat || (a.lat === b.lat && a.lon <= b.lon);
  return keepOrder
    ? { start: a, end: b, reversed: false }
    : { start: b, end: a, reversed: true };
}

function adaptOsmRoutePlacesForDirection(
  data: Json,
  segment: { start: { lat: number; lon: number }; end: { lat: number; lon: number }; reversed: boolean },
): Json {
  if (!segment.reversed) {
    return data;
  }

  const basePlaces = Array.isArray(data.places) ? (data.places as Json[]) : [];
  const segmentMeters = Math.max(0, Math.round(haversineMeters(segment.start, segment.end)));
  const remapped = basePlaces
    .map((raw) => {
      const place = { ...raw } as Json;
      const oldSort = Number(place.sortMeters || 0);
      const mappedSort = Math.max(0, Math.min(segmentMeters, segmentMeters - oldSort));
      place.sortMeters = mappedSort;
      place.distanceMeters = mappedSort;
      return place;
    })
    .sort((a, b) => Number(a.sortMeters || 0) - Number(b.sortMeters || 0));

  const routeLines = remapped.length
    ? remapped.map((place) => {
        const sortMeters = Math.max(0, Number(place.sortMeters || 0));
        return `${Math.round(sortMeters)}m：${formatOsmPlaceLine(place as OsmPlaceCandidate, false)}`;
      })
    : ["未找到可排序的沿街樓宇/地點，可能是此段 OSM 門牌或名稱資料不足。"];

  const endpoint = String(data.endpoint || "");
  const text = [
    `沿街 OSM 地點整理完成，共 ${remapped.length} 個候選點。`,
    endpoint ? `來源：${endpoint}` : "",
    "",
    ...routeLines,
  ].filter(Boolean).join("\n");

  return {
    ...data,
    count: remapped.length,
    places: remapped,
    text,
  } as Json;
}

async function handleGoogleRoutePlaces(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  await requireClerkAuth(request, env);
  await ensureD1Schema(env);
  const body = await requireJson(request);
  requireUserConfirmedPaidCall(body);

  const start = body.start as Json;
  const end = body.end as Json;
  const roadName = String(body.roadName || "").trim();
  const language = normalizeMapsLanguage(String(body.language || "zh-TW"));

  const startPoint = { lat: Number(start.lat), lon: Number(start.lon) };
  const endPoint = { lat: Number(end.lat), lon: Number(end.lon) };
  if (![startPoint.lat, startPoint.lon, endPoint.lat, endPoint.lon].every(Number.isFinite)) {
    throw new Error("start and end coordinates are required");
  }

  const cachePayload = {
    roadName: normalizeRoadName(roadName),
    language,
    start: { lat: round5(startPoint.lat), lon: round5(startPoint.lon) },
    end: { lat: round5(endPoint.lat), lon: round5(endPoint.lon) },
    version: 1,
  };

  const cached = await getOrCreateCached(
    env,
    "google-route-places-v1",
    cachePayload,
    async () => {
      const places = await fetchGooglePlacesAlongSegment(env, startPoint, endPoint, roadName, language);
      const lines = places.length
        ? places.map((place) => `${Math.max(0, place.sortMeters)}m：${formatGoogleRoutePlaceLine(place)}`)
        : ["此段未找到 Google Places 地點。"];

      return {
        ok: true,
        provider: "google-route-places",
        count: places.length,
        text: [
          `沿街 Google Places 整理完成，共 ${places.length} 個候選點。`,
          ...lines,
        ].join("\n"),
        places,
      } as Json;
    },
    TTL_365_DAYS,
    {
      ctx,
      staleWhileRevalidateSeconds: 30 * DAY,
    },
  );

  return json(cached.data);
}

async function handleIntersectionAddressBatch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await requireJson(request);
  
  // Support both request formats:
  // 1. iOS format: { coordinates: [{lat, lon}, ...] }
  // 2. Legacy format: { roadName, points: [{id, lat, lon}, ...], maxItems }
  
  const coordinates = Array.isArray(body.coordinates) ? body.coordinates : [];
  
  if (coordinates.length > 0) {
    // iOS app format: simple coordinate batch geocoding
    return handleCoordinateBatch(request, env, ctx, coordinates);
  }
  
  // Legacy format: intersection-specific addressing
  const roadName = String(body.roadName || "").trim();
  const pointsRaw = Array.isArray(body.points) ? (body.points as Json[]) : [];
  const maxItems = Math.max(1, Math.min(20, Number(body.maxItems ?? 8)));

  const points = pointsRaw
    .slice(0, maxItems)
    .map((item, idx) => ({
      idx: Number(item.idx ?? idx),
      id: Number(item.id),
      lat: Number(item.lat),
      lon: Number(item.lon),
    }))
    .filter((p) => Number.isFinite(p.id) && Number.isFinite(p.lat) && Number.isFinite(p.lon));

  const rows = await Promise.all(
    points.map(async (point) => {
      try {
        const reverse = await fetchNominatimReverse(env, point.lat, point.lon, ctx);
        const address = buildIntersectionAddressLabel(reverse, roadName);
        return {
          idx: point.idx,
          id: point.id,
          addressLabel: address.label,
          addressSource: address.source,
        };
      } catch {
        return {
          idx: point.idx,
          id: point.id,
          addressLabel: null,
          addressSource: null,
        };
      }
    }),
  );

  return json({
    ok: true,
    count: rows.length,
    rows,
  });
}

async function handleCoordinateBatch(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  coordinates: Array<Record<string, unknown>>,
): Promise<Response> {
  const addresses: GeocodedAddress[] = [];
  
  if (!coordinates.length) {
    return json({ addresses });
  }
  
  for (const coord of coordinates) {
    const lat = Number(coord.lat);
    const lon = Number(coord.lon);
    
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      continue;
    }
    
    validateCoordinates(lat, lon);
    
    try {
      const reverse = await fetchNominatimReverse(env, lat, lon, ctx);
      const address = (reverse.address || {}) as Record<string, unknown>;
      
      let streetName: string | null = null;
      let subThoroughfare: string | null = null;
      
      // Extract street name from Nominatim address
      if (address.road) {
        streetName = String(address.road);
      } else if (address.street) {
        streetName = String(address.street);
      }
      
      // Extract house number
      if (address.house_number) {
        subThoroughfare = String(address.house_number);
      }
      
      const addressLine = subThoroughfare && streetName ? `${subThoroughfare} ${streetName}` : (streetName || null);
      
      addresses.push({
        lat: round6(lat),
        lon: round6(lon),
        streetName,
        subThoroughfare,
        addressLine,
      });
    } catch {
      // On error, add a result with null address fields
      addresses.push({
        lat: round6(lat),
        lon: round6(lon),
        streetName: null,
        subThoroughfare: null,
        addressLine: null,
      });
    }
  }
  
  return json({ addresses });
}

async function enrichIntersectionsWithAddresses(
  env: Env,
  ctx: ExecutionContext,
  intersections: Array<Omit<IntersectionRow, "addressLabel" | "addressSource">>,
  roadName: string,
): Promise<IntersectionRow[]> {
  return Promise.all(
    intersections.map(async (row, index) => {
      try {
        const sample = chooseIntersectionAddressSample(intersections, index);
        const reverse = await fetchNominatimReverse(env, sample.lat, sample.lon, ctx);
        const address = buildIntersectionAddressLabel(reverse, roadName);
        return {
          ...row,
          addressLabel: address.label,
          addressSource: address.source,
        };
      } catch {
        return {
          ...row,
          addressLabel: null,
          addressSource: null,
        };
      }
    }),
  );
}

function chooseIntersectionAddressSample(
  intersections: Array<{ lat: number; lon: number }>,
  index: number,
): { lat: number; lon: number } {
  const current = intersections[index];
  const anchor = intersections[index + 1] || intersections[index - 1];
  if (!current || !anchor) {
    return current;
  }

  const distance = haversineMeters(current, anchor);
  if (!Number.isFinite(distance) || distance <= 1) {
    return current;
  }

  const meters = Math.min(18, distance * 0.35);
  const ratio = meters / distance;
  return {
    lat: current.lat + (anchor.lat - current.lat) * ratio,
    lon: current.lon + (anchor.lon - current.lon) * ratio,
  };
}

function buildIntersectionAddressLabel(reverse: Json, roadName: string): { label: string | null; source: string | null } {
  const address = (reverse.address || {}) as Json;
  const streetName = String(
    address.road || address.pedestrian || address.residential || address.footway || address.cycleway || address.path || "",
  ).trim();
  const houseNumber = String(address.house_number || "").trim();
  const houseName = String(address.house_name || "").trim();
  const exact = formatStreetAddress(streetName, houseNumber, houseName);
  const onTargetRoad = exact && streetName ? isTargetRoadPlace(streetName, roadName) : false;

  if (onTargetRoad && exact) {
    return { label: exact, source: "on-road" };
  }
  if (exact) {
    return { label: exact, source: "nearby" };
  }

  return { label: null, source: null };
}

function buildOsmAroundPlaceQuery(lat: number, lon: number, radius: number): string {
  return `
[out:json][timeout:25];
(
${buildOsmPlaceStatements(`(around:${Math.round(radius)},${lat},${lon})`)}
);
out center tags;
`;
}

function buildOsmBBoxPlaceQuery(bbox: BBox): string {
  return `
[out:json][timeout:25];
(
${buildOsmPlaceStatements(`(${bbox.south},${bbox.west},${bbox.north},${bbox.east})`)}
);
out body geom;
`;
}

function buildOsmPlaceStatements(selector: string): string {
  const lines: string[] = [];

  // Keep queries selective to reduce Overpass payload.
  for (const elementType of ["node", "way"]) {
    lines.push(`  ${elementType}["amenity"]["name"]${selector};`);
    lines.push(`  ${elementType}["shop"]["name"]${selector};`);
    lines.push(`  ${elementType}["tourism"]["name"]${selector};`);
    lines.push(`  ${elementType}["office"]["name"]${selector};`);
    lines.push(`  ${elementType}["addr:housenumber"]["addr:street"]${selector};`);
    lines.push(`  ${elementType}["addr:housenumber"]["addr:place"]${selector};`);
  }

  // Transit: bus stops, tram, MTR / subway entrances, platforms
  lines.push(`  node["highway"="bus_stop"]${selector};`);
  lines.push(`  node["public_transport"~"platform|stop_position"]${selector};`);
  lines.push(`  way["public_transport"~"platform"]${selector};`);
  lines.push(`  node["railway"~"station|halt|tram_stop|subway_entrance"]${selector};`);
  lines.push(`  way["railway"~"station|halt|tram_stop"]${selector};`);

  // Entrances and pedestrian crossings
  lines.push(`  node["entrance"]${selector};`);
  lines.push(`  node["highway"="crossing"]${selector};`);

  // Named buildings (ways only; nodes already covered by name tag above)
  lines.push(`  way["building"]["name"]${selector};`);

  // High-value named leisure landmarks
  lines.push(`  node["leisure"~"park|playground|sports_centre|stadium|swimming_pool|garden"]["name"]${selector};`);
  lines.push(`  way["leisure"~"park|playground|sports_centre|stadium|swimming_pool|garden"]["name"]${selector};`);

  // High-value named landuse areas
  lines.push(`  way["landuse"~"retail|commercial|industrial|cemetery|recreation_ground"]["name"]${selector};`);

  return lines.join("\n");
}

function parseOsmPlaceCandidates(overpass: Json): OsmPlaceCandidate[] {
  const elements = Array.isArray(overpass.elements) ? (overpass.elements as Json[]) : [];
  const nodeLookup = new Map<number, { lat: number; lon: number }>();
  for (const element of elements) {
    if (String(element.type || "") !== "node") {
      continue;
    }
    const id = Number(element.id);
    const lat = Number(element.lat);
    const lon = Number(element.lon);
    if (Number.isFinite(id) && Number.isFinite(lat) && Number.isFinite(lon)) {
      nodeLookup.set(id, { lat, lon });
    }
  }
  const entranceBuildingNames = mapEntranceBuildingNames(elements);
  const rows: OsmPlaceCandidate[] = [];

  for (const element of elements) {
    const row = buildOsmPlaceCandidate(element, nodeLookup, entranceBuildingNames);
    if (row) {
      rows.push(row);
    }
  }

  return rows;
}

function buildOsmPlaceCandidate(
  element: Json,
  nodeLookup: Map<number, { lat: number; lon: number }>,
  entranceBuildingNames: Map<number, string>,
): OsmPlaceCandidate | null {
  const type = String(element.type || "").trim();
  const center = (element.center || {}) as Json;
  const tags = (element.tags || {}) as Json;
  const wayCenter = type === "way"
    ? centerFromWayNodes(Array.isArray(element.nodes) ? (element.nodes as number[]) : [], nodeLookup)
    : null;
  const lat = type === "node"
    ? Number(element.lat)
    : Number.isFinite(Number(center.lat))
      ? Number(center.lat)
      : Number(wayCenter?.lat);
  const lon = type === "node"
    ? Number(element.lon)
    : Number.isFinite(Number(center.lon))
      ? Number(center.lon)
      : Number(wayCenter?.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  const highwayVal = String(tags.highway || "").trim();
  if (highwayVal && highwayVal !== "bus_stop" && highwayVal !== "crossing") {
    return null;
  }
  const streetName = String(tags["addr:street"] || tags["addr:place"] || "").trim() || null;
  const houseNumber = String(tags["addr:housenumber"] || "").trim();
  const houseName = String(tags["addr:housename"] || "").trim();
  const addressLabel = formatStreetAddress(streetName, houseNumber, houseName);
  const entranceBuildingName = type === "node" ? (entranceBuildingNames.get(Number(element.id)) || "") : "";
  const explicitName = String(tags["name:zh"] || tags.name || tags.brand || tags.operator || tags.ref || "").trim();
  const kindLabel = describeOsmKind(tags);
  const hasSpecificFeature = Boolean(
    tags.amenity || tags.shop || tags.tourism || tags.office ||
    tags.railway || tags.public_transport || tags.entrance ||
    highwayVal === "bus_stop" || highwayVal === "crossing" ||
    tags.leisure || tags.landuse
  );
  const title = explicitName || (entranceBuildingName ? `${entranceBuildingName} 入口` : null) || addressLabel || (hasSpecificFeature ? kindLabel : null);

  if (!title) {
    return null;
  }

  return {
    id: `${type}:${String(element.id || "")}`,
    lat,
    lon,
    title,
    addressLabel,
    kindLabel,
    streetName,
    distanceMeters: 0,
    sortMeters: 0,
    distanceToLineMeters: 0,
    onTargetRoad: false,
    hasHouseNumber: Boolean(houseNumber),
    hasExplicitName: Boolean(explicitName),
    hasFeatureTag: hasSpecificFeature,
  };
}

function mapEntranceBuildingNames(elements: Json[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const element of elements) {
    if (String(element.type || "") !== "way") {
      continue;
    }
    const tags = (element.tags || {}) as Json;
    const building = String(tags.building || "").trim();
    if (!building || building === "no") {
      continue;
    }
    const name = String(tags["name:zh"] || tags.name || "").trim();
    if (!name) {
      continue;
    }
    const nodes = Array.isArray(element.nodes) ? (element.nodes as number[]) : [];
    for (const nodeId of nodes) {
      if (!map.has(nodeId)) {
        map.set(nodeId, name);
      }
    }
  }
  return map;
}

function centerFromWayNodes(
  nodeIds: number[],
  nodeLookup: Map<number, { lat: number; lon: number }>,
): { lat: number; lon: number } | null {
  if (nodeIds.length === 0) {
    return null;
  }
  let totalLat = 0;
  let totalLon = 0;
  let count = 0;
  for (const nodeId of nodeIds) {
    const node = nodeLookup.get(nodeId);
    if (!node) {
      continue;
    }
    totalLat += node.lat;
    totalLon += node.lon;
    count += 1;
  }
  if (count === 0) {
    return null;
  }
  return { lat: totalLat / count, lon: totalLon / count };
}

function shouldIncludeIntersectionCrossWay(way: { tags: Json }): boolean {
  const highway = String(way.tags.highway || "").trim().toLowerCase();
  if (!highway) {
    return false;
  }
  return highway !== "footway" && highway !== "path" && highway !== "steps";
}

function dedupeOsmPlaces(places: OsmPlaceCandidate[]): OsmPlaceCandidate[] {
  const seen = new Set<string>();
  const out: OsmPlaceCandidate[] = [];

  for (const place of places) {
    const key = [
      normalizeRoadName(place.title),
      normalizeRoadName(place.addressLabel || ""),
      Math.round(place.lat * 10000),
      Math.round(place.lon * 10000),
    ].join("|");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(place);
  }

  return out;
}

function prioritizeRoutePlaces(candidates: OsmPlaceCandidate[]): OsmPlaceCandidate[] {
  const sorted = [...candidates].sort((a, b) => a.sortMeters - b.sortMeters || a.distanceToLineMeters - b.distanceToLineMeters);
  const filtered: OsmPlaceCandidate[] = [];
  const onRoadPool = sorted.filter((place) => place.onTargetRoad);
  const hasEnoughOnRoad = onRoadPool.length >= 5;
  const hasEnoughOnRoadAddresses = onRoadPool.filter((place) => place.hasHouseNumber).length >= 3;

  for (const place of sorted) {
    if (place.onTargetRoad) {
      filtered.push(place);
      continue;
    }

    if (hasEnoughOnRoadAddresses) {
      continue;
    }

    if (hasEnoughOnRoad && place.distanceToLineMeters > 12) {
      continue;
    }

    if (!place.hasHouseNumber && !place.hasExplicitName) {
      continue;
    }

    const nearbyOnRoad = filtered.some(
      (kept) => kept.onTargetRoad && Math.abs(kept.sortMeters - place.sortMeters) <= 35,
    );
    if (nearbyOnRoad && place.distanceToLineMeters > 10) {
      continue;
    }

    filtered.push(place);
  }

  return filtered.sort((a, b) => {
    const aBand = routePlaceBand(a);
    const bBand = routePlaceBand(b);
    return aBand - bBand || a.sortMeters - b.sortMeters || a.distanceToLineMeters - b.distanceToLineMeters;
  });
}

function routePlaceBand(place: OsmPlaceCandidate): number {
  if (place.onTargetRoad && place.hasHouseNumber) {
    return 0;
  }
  if (place.onTargetRoad && (place.hasExplicitName || place.hasFeatureTag)) {
    return 1;
  }
  if (place.onTargetRoad) {
    return 2;
  }
  if (place.hasHouseNumber) {
    return 3;
  }
  return 4;
}

function assessOsmCoverage(selected: OsmPlaceCandidate[], allCandidates: OsmPlaceCandidate[]): OsmCoverageAssessment {
  const onRoadAddressCount = selected.filter((place) => place.onTargetRoad && place.hasHouseNumber).length;
  const onRoadNamedCount = selected.filter((place) => place.onTargetRoad && place.hasExplicitName).length;
  const unnamedCommercialCount = allCandidates.filter(
    (place) => place.onTargetRoad && place.hasFeatureTag && !place.hasExplicitName,
  ).length;
  const likelyCommercialUnnamed = unnamedCommercialCount >= 4 && onRoadNamedCount === 0;

  if (selected.length < 3) {
    return {
      onRoadAddressCount,
      onRoadNamedCount,
      totalCount: selected.length,
      likelyCommercialUnnamed,
      shouldFallback: true,
      reason: "OSM 候選點少於 3 個",
    };
  }

  if (onRoadAddressCount === 0) {
    return {
      onRoadAddressCount,
      onRoadNamedCount,
      totalCount: selected.length,
      likelyCommercialUnnamed,
      shouldFallback: true,
      reason: "OSM 缺少目標道路門牌",
    };
  }

  if (likelyCommercialUnnamed) {
    return {
      onRoadAddressCount,
      onRoadNamedCount,
      totalCount: selected.length,
      likelyCommercialUnnamed,
      shouldFallback: true,
      reason: "疑似商業街但缺少店名",
    };
  }

  return {
    onRoadAddressCount,
    onRoadNamedCount,
    totalCount: selected.length,
    likelyCommercialUnnamed,
    shouldFallback: false,
    reason: "OSM 資料足夠",
  };
}

function shouldUseGooglePlacesFallback(assessment: OsmCoverageAssessment): boolean {
  return assessment.shouldFallback;
}

async function fetchGooglePlacesAlongSegment(
  env: Env,
  start: { lat: number; lon: number },
  end: { lat: number; lon: number },
  roadName: string,
  language: string,
): Promise<GoogleRoutePlaceCandidate[]> {
  const apiKey = requireGoogleMapsKey(env);
  const samplePoints = buildGoogleFallbackSamplePoints(start, end);
  const results: GoogleRoutePlaceCandidate[] = [];

  for (let i = 0; i < samplePoints.length; i += 1) {
    const point = samplePoints[i];
    const places = await fetchGooglePlaces(apiKey, round6(point.lat), round6(point.lon), 35, language);
    const list = Array.isArray(places.places) ? (places.places as Json[]) : [];

    for (const item of list) {
      const candidate = buildGoogleRoutePlaceCandidate(item, start, end, roadName);
      if (candidate) {
        results.push(candidate);
      }
    }
  }

  return dedupeGoogleRoutePlaces(results)
    .filter((place) => place.distanceToLineMeters <= 22)
    .sort((a, b) => a.sortMeters - b.sortMeters || a.distanceToLineMeters - b.distanceToLineMeters)
    .slice(0, 8);
}

function buildGoogleFallbackSamplePoints(
  start: { lat: number; lon: number },
  end: { lat: number; lon: number },
): Array<{ lat: number; lon: number }> {
  const total = haversineMeters(start, end);
  const segments = total < 80 ? [0.5] : total < 180 ? [0.25, 0.75] : [0.15, 0.5, 0.85];
  return segments.map((t) => ({
    lat: start.lat + (end.lat - start.lat) * t,
    lon: start.lon + (end.lon - start.lon) * t,
  }));
}

function buildGoogleRoutePlaceCandidate(
  item: Json,
  start: { lat: number; lon: number },
  end: { lat: number; lon: number },
  roadName: string,
): GoogleRoutePlaceCandidate | null {
  const location = (item.location || {}) as Json;
  const lat = Number(location.latitude);
  const lon = Number(location.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  const displayName = (item.displayName || {}) as Json;
  const title = String(displayName.text || "").trim();
  if (!title) {
    return null;
  }

  const types = Array.isArray(item.types) ? (item.types as string[]) : [];
  const vicinity = String(item.formattedAddress || "").trim() || null;
  const streetName = extractGoogleStreetName(vicinity);
  if (roadName && streetName && !isTargetRoadPlace(streetName, roadName)) {
    return null;
  }

  const projection = projectPointToSegmentMeters(start, end, { lat, lon });
  return {
    id: `${normalizeRoadName(title)}:${round5(lat)}:${round5(lon)}`,
    title,
    typeLabel: types.length ? types.slice(0, 2).join("/") : null,
    addressLabel: vicinity,
    lat,
    lon,
    sortMeters: Math.round(projection.alongMeters),
    distanceToLineMeters: Math.round(projection.distanceToLineMeters),
  };
}

function extractGoogleStreetName(vicinity: string | null): string | null {
  if (!vicinity) {
    return null;
  }
  const first = vicinity.split(",")[0]?.trim() || "";
  return first || null;
}

function dedupeGoogleRoutePlaces(places: GoogleRoutePlaceCandidate[]): GoogleRoutePlaceCandidate[] {
  const seen = new Set<string>();
  const out: GoogleRoutePlaceCandidate[] = [];

  for (const place of places) {
    const key = [normalizeRoadName(place.title), Math.round(place.lat * 10000), Math.round(place.lon * 10000)].join("|");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(place);
  }

  return out;
}

function formatGoogleRoutePlaceLine(place: GoogleRoutePlaceCandidate): string {
  const parts = [place.title];
  if (place.addressLabel) {
    parts.push(place.addressLabel);
  }
  if (place.typeLabel) {
    parts.push(place.typeLabel);
  }
  return parts.join("，");
}

function formatOsmPlaceLine(place: OsmPlaceCandidate, includeDistance: boolean): string {
  const parts = [place.title];
  if (place.addressLabel && place.addressLabel !== place.title) {
    parts.push(place.addressLabel);
  }
  if (place.kindLabel && place.kindLabel !== place.title) {
    parts.push(place.kindLabel);
  }
  if (includeDistance) {
    parts.push(`${place.distanceMeters}m`);
  }
  return parts.filter(Boolean).join("，");
}

function formatStreetAddress(streetName: string | null, houseNumber: string, houseName: string): string | null {
  const parts = [streetName || "", houseNumber].filter(Boolean);
  const base = parts.join(" ").trim();
  if (houseName && houseName !== base) {
    return base ? `${base}，${houseName}` : houseName;
  }
  return base || null;
}

function describeOsmKind(tags: Json): string | null {
  // Transit: highway values
  const highwayVal = String(tags.highway || "").trim();
  if (highwayVal === "bus_stop") return "巴士站";
  if (highwayVal === "crossing") return "行人過路";

  // Transit: railway values
  const railwayVal = String(tags.railway || "").trim();
  if (railwayVal === "tram_stop") return "電車站";
  if (railwayVal === "subway_entrance") return "港鐵出入口";
  if (railwayVal === "station") return "鐵路站";
  if (railwayVal === "halt") return "車站";

  // Transit: public_transport
  const ptVal = String(tags.public_transport || "").trim();
  if (ptVal === "platform") return "月台";
  if (ptVal === "stop_position") return "站";

  // Entrance
  const entranceVal = String(tags.entrance || "").trim();
  if (entranceVal && entranceVal !== "no") return "入口";

  // Leisure landmarks
  const leisureVal = String(tags.leisure || "").trim();
  const leisureLabels: Record<string, string> = {
    park: "公園",
    playground: "遊樂場",
    sports_centre: "體育中心",
    stadium: "體育場",
    swimming_pool: "游泳池",
    garden: "花園",
  };
  if (leisureVal) return leisureLabels[leisureVal] ?? leisureVal.replaceAll("_", " ");

  // Landuse areas
  const landuseVal = String(tags.landuse || "").trim();
  const landuseLabels: Record<string, string> = {
    retail: "商業區",
    commercial: "商業區",
    industrial: "工業區",
    cemetery: "墳場",
    recreation_ground: "休憩用地",
  };
  if (landuseVal) return landuseLabels[landuseVal] ?? null;

  // Amenity / shop / tourism / office / building
  const raw = String(tags.amenity || tags.shop || tags.tourism || tags.office || tags.building || "").trim();
  if (!raw || raw === "yes") {
    return null;
  }

  const labels: Record<string, string> = {
    restaurant: "餐廳",
    cafe: "咖啡店",
    fast_food: "速食店",
    bank: "銀行",
    pharmacy: "藥局",
    hospital: "醫院",
    clinic: "診所",
    school: "學校",
    university: "大學",
    hotel: "旅館",
    convenience: "便利店",
    supermarket: "超市",
    clothes: "服飾店",
    beauty: "美容店",
    mall: "商場",
    attraction: "景點",
    office: "辦公室",
    commercial: "商業大廈",
    apartments: "住宅大樓",
    bus_station: "巴士總站",
    ferry_terminal: "渡輪碼頭",
  };

  return labels[raw] || raw.replaceAll("_", " ");
}

function isTargetRoadPlace(streetName: string | null, roadName: string): boolean {
  if (!streetName || !roadName) {
    return false;
  }
  return isRoadNameMatch(normalizeRoadName(streetName), normalizeRoadName(roadName), tokenizeRoadQuery(roadName));
}

function expandBBoxAroundSegment(
  start: { lat: number; lon: number },
  end: { lat: number; lon: number },
  padMeters: number,
): BBox {
  const avgLat = (start.lat + end.lat) / 2;
  const latPad = metersToLatDegrees(padMeters);
  const lonPad = metersToLonDegrees(padMeters, avgLat);
  return {
    south: Math.min(start.lat, end.lat) - latPad,
    west: Math.min(start.lon, end.lon) - lonPad,
    north: Math.max(start.lat, end.lat) + latPad,
    east: Math.max(start.lon, end.lon) + lonPad,
  };
}

function projectPointToSegmentMeters(
  start: { lat: number; lon: number },
  end: { lat: number; lon: number },
  point: { lat: number; lon: number },
): { alongMeters: number; distanceToLineMeters: number } {
  const startVec = { x: 0, y: 0 };
  const endVec = toLocalMeters(start, end);
  const pointVec = toLocalMeters(start, point);
  const dx = endVec.x - startVec.x;
  const dy = endVec.y - startVec.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq <= 1e-6) {
    return { alongMeters: 0, distanceToLineMeters: Math.sqrt(pointVec.x ** 2 + pointVec.y ** 2) };
  }

  const t = Math.max(0, Math.min(1, (pointVec.x * dx + pointVec.y * dy) / lenSq));
  const projX = dx * t;
  const projY = dy * t;
  const diffX = pointVec.x - projX;
  const diffY = pointVec.y - projY;
  return {
    alongMeters: Math.sqrt(dx * dx + dy * dy) * t,
    distanceToLineMeters: Math.sqrt(diffX * diffX + diffY * diffY),
  };
}

function toLocalMeters(origin: { lat: number; lon: number }, point: { lat: number; lon: number }): { x: number; y: number } {
  const avgLatRad = ((origin.lat + point.lat) / 2) * (Math.PI / 180);
  return {
    x: (point.lon - origin.lon) * 111_320 * Math.cos(avgLatRad),
    y: (point.lat - origin.lat) * 110_540,
  };
}

function metersToLatDegrees(meters: number): number {
  return meters / 110_540;
}

function metersToLonDegrees(meters: number, lat: number): number {
  const cosLat = Math.max(0.1, Math.cos((lat * Math.PI) / 180));
  return meters / (111_320 * cosLat);
}

function sanitizeErrorMessage(message: string): string {
  if (/api[_-]?key/i.test(message)) return "Configuration error";
  if (/\bD1\b|sqlite|database/i.test(message)) return "Database error";
  if (message.includes("sk_") || message.includes("pk_")) return "Configuration error";
  return message;
}

async function withErrorHandling(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    const raw = err instanceof Error ? err.message : "Unexpected error";
    console.error({ timestamp: new Date().toISOString(), error: raw });
    const status =
      raw === "Authentication required" || raw === "Invalid or expired session"
        ? 401
        : raw === "Cloudflare Access authentication required"
          ? 401
        : raw === "Your account is pending approval" || raw === "Admin access required"
          ? 403
          : raw === "Access denied for this email"
            ? 403
            : raw === "Too many requests"
              ? 429
          : 500;
    return json({ error: sanitizeErrorMessage(raw) }, status);
  }
}

function getEdgeCache(): Cache {
  return (caches as CacheStorage & { default: Cache }).default;
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

function requireGeminiKey(env: Env): string {
  const key = env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("GEMINI_API_KEY is not configured");
  }
  return key;
}

// ── Clerk authentication ──────────────────────────────────────────────────
function base64UrlDecode(input: string): Uint8Array {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function fetchClerkJWKS(): Promise<JsonWebKey[]> {
  const edgeReq = new Request(`https://cache.local/clerk-jwks/${CLERK_DOMAIN}`);
  const cached = await getEdgeCache().match(edgeReq);
  if (cached) {
    const data = (await cached.json()) as { keys: JsonWebKey[] };
    return data.keys;
  }
  const res = await fetchWithTimeout(`https://${CLERK_DOMAIN}/.well-known/jwks.json`, {}, 5000);
  if (!res.ok) throw new Error("Failed to fetch authentication keys");
  const data = (await res.json()) as { keys: JsonWebKey[] };
  await getEdgeCache().put(
    edgeReq,
    new Response(JSON.stringify(data), {
      headers: { "cache-control": "public, max-age=3600", "content-type": "application/json" },
    }),
  );
  return data.keys;
}

async function verifyClerkToken(token: string): Promise<{ userId: string; payload: ClerkJwtPayload } | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, signatureB64] = parts;
    const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(headerB64))) as {
      kid: string;
      alg: string;
    };
    if (header.alg !== "RS256") return null;
    const keys = await fetchClerkJWKS();
    const jwk = keys.find((k) => (k as Record<string, unknown>).kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const signatureBytes = base64UrlDecode(signatureB64);
    const signature = new Uint8Array(signatureBytes.length);
    signature.set(signatureBytes);
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, signingInput);
    if (!valid) return null;
    const payload = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(payloadB64)),
    ) as ClerkJwtPayload;
    const now = Math.floor(Date.now() / 1000);
    if (!payload.sub || !Number.isFinite(payload.exp)) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (Number.isFinite(payload.nbf) && Number(payload.nbf) > now + 30) return null;
    if (Number.isFinite(payload.iat) && Number(payload.iat) > now + 30) return null;
    return { userId: payload.sub, payload };
  } catch {
    return null;
  }
}

function issuerMatches(iss: string | undefined): boolean {
  const normalized = String(iss || "").trim().replace(/\/+$/, "");
  return normalized === CLERK_ISSUER.replace(/\/+$/, "");
}

function audienceMatches(aud: string | string[] | undefined, expected: string): boolean {
  if (!aud) return false;
  const target = expected.trim();
  if (!target) return true;
  if (Array.isArray(aud)) {
    return aud.some((item) => String(item).trim() === target);
  }
  return String(aud).trim() === target;
}

async function getClerkUserMeta(
  userId: string,
  secretKey: string,
): Promise<{ approved: boolean; email: string; isAdmin: boolean }> {
  const edgeReq = new Request(`https://cache.local/clerk-user-meta/${userId}`);
  const cached = await getEdgeCache().match(edgeReq);
  if (cached) {
    return (await cached.json()) as { approved: boolean; email: string; isAdmin: boolean };
  }
  const res = await fetchWithTimeout(
    `https://api.clerk.com/v1/users/${encodeURIComponent(userId)}`,
    { headers: { Authorization: `Bearer ${secretKey}` } },
    5000,
  );
  if (!res.ok) return { approved: false, email: "", isAdmin: false };
  const user = (await res.json()) as {
    public_metadata?: { approved?: boolean; role?: string };
    email_addresses?: Array<{ email_address: string }>;
  };
  const approved = user.public_metadata?.approved === true;
  const email = user.email_addresses?.[0]?.email_address || "";
  const isAdmin = user.public_metadata?.role === "admin" || BUILTIN_ADMIN_EMAILS.has(email.toLowerCase());
  const result = { approved, email, isAdmin };
  await getEdgeCache().put(
    edgeReq,
    new Response(JSON.stringify(result), {
      headers: { "cache-control": "public, max-age=60", "content-type": "application/json" },
    }),
  );
  return result;
}

async function requireClerkAuth(
  request: Request,
  env: Env,
): Promise<{ userId: string; email: string; isAdmin: boolean }> {
  const host = new URL(request.url).hostname.toLowerCase();
  const isDev = host === "127.0.0.1" || host === "localhost";
  const devBypass = String(env.ALLOW_DEV_BYPASS || "").toLowerCase() === "true";
  if (isDev && devBypass) {
    return { userId: "dev", email: "dev@local", isAdmin: true };
  }
  const secretKey = env.CLERK_SECRET_KEY || "";
  if (!secretKey) {
    throw new Error("Authentication not configured");
  }
  const authHeader = request.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    throw new Error("Authentication required");
  }
  const token = authHeader.slice(7);
  const verified = await verifyClerkToken(token);
  if (!verified) {
    throw new Error("Invalid or expired session");
  }
  if (!issuerMatches(verified.payload.iss)) {
    throw new Error("Invalid or expired session");
  }
  const expectedAud = String(env.CLERK_JWT_AUDIENCE || "").trim();
  if (expectedAud && !audienceMatches(verified.payload.aud, expectedAud)) {
    throw new Error("Invalid or expired session");
  }
  await applyRateLimit(request, env, `user-auth:${verified.userId}`, RATE_LIMIT_DEFAULT_PER_WINDOW, RATE_LIMIT_WINDOW_SECONDS);
  const meta = await getClerkUserMeta(verified.userId, secretKey);
  if (!meta.approved) {
    throw new Error("Your account is pending approval");
  }
  return { userId: verified.userId, email: meta.email, isAdmin: meta.isAdmin };
}

async function requireAdminAuth(
  request: Request,
  env: Env,
): Promise<{ userId: string; email: string }> {
  const user = await requireClerkAuth(request, env);
  if (!user.isAdmin) {
    throw new Error("Admin access required");
  }
  return user;
}

async function handlePaidPlaces(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  const clerkUser = await requireClerkAuth(request, env);
  await ensureD1Schema(env);
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_REQUEST_BODY_BYTES) {
    throw new Error("Request body too large");
  }
  const body = await requireJson(request);
  requireUserConfirmedPaidCall(body);

  const intersections = Array.isArray(body.intersections) ? body.intersections : [];
  const radius = Number(body.radius ?? 50);
  if (intersections.length === 0) {
    throw new Error("intersections is required");
  }
  if (intersections.length > MAX_PAID_INTERSECTIONS) {
    throw new Error(`Maximum ${MAX_PAID_INTERSECTIONS} intersections per request`);
  }

  const apiKey = requireGoogleMapsKey(env);
  const language = normalizeMapsLanguage(String(body.language || "zh-TW"));

  const lines: string[] = [];
  let billableCalls = 0;
  let cacheHits = 0;

  for (const item of intersections) {
    const row = item as Json;
    const lat = Number(row.lat);
    const lon = Number(row.lon);
    validateCoordinates(lat, lon);
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

    const list = Array.isArray((cached.data as Json).places) ? ((cached.data as Json).places as Json[]) : [];
    const top = list.slice(0, 5).map((p) => {
      const displayName = (p.displayName || {}) as Json;
      const title = String(displayName.text || "未命名地標");
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
    userId: clerkUser.userId,
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

async function handlePaidStreetView(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const clerkUser = await requireClerkAuth(request, env);
  await ensureD1Schema(env);
  const body = await requireJson(request);
  requireUserConfirmedPaidCall(body);

  const lat = Number(body.lat ?? 0);
  const lon = Number(body.lon ?? 0);
  const panoId = String(body.panoId || "").trim() || null;
  const heading = Number(body.heading ?? 0);
  const fov = Number(body.fov ?? 90);
  const pitch = Number(body.pitch ?? 0);
  const language = normalizeMapsLanguage(String(body.language || "zh-TW"));
  const useLlm = body.useLlm !== false;
  const mapsKey = requireGoogleMapsKey(env);
  const llmKey = useLlm ? requireGeminiKey(env) : null;

  // Support both panoId-based and lat/lon-based requests
  let metadata: StreetViewMetadataDetails;
  
  if (panoId) {
    // If panoId provided, fetch metadata with a dummy coordinate (or extract from cache)
    // For simplicity, we'll just create a minimal metadata object
    // In production, you might cache pano metadata separately
    metadata = {
      status: "OK",
      panoId,
      lat: round6(lat),
      lon: round6(lon),
      copyright: null,
      date: null,
    };
  } else {
    // Traditional lat/lon lookup
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new Error("panoId or (lat,lon) is required");
    }
    validateCoordinates(lat, lon);
    metadata = await fetchStreetViewMetadataDetails(mapsKey, round6(lat), round6(lon));
  }

  if (metadata.status === "ZERO_RESULTS" || metadata.status === "NOT_FOUND") {
    return json({
      ok: true,
      provider: "streetview",
      hasStreetView: false,
      metadataStatus: metadata.status,
      text: `此地點無 Street View 覆蓋（${metadata.status}）`,
    });
  }

  const indoorLikely = panoId ? await detectIndoorPanoramaLikelyByPanoId(mapsKey, panoId) : await detectIndoorPanoramaLikely(mapsKey, metadata);

  const views = [
    { label: "前方", heading: normalizeHeading(heading + 0) },
    { label: "右方", heading: normalizeHeading(heading + 90) },
    { label: "後方", heading: normalizeHeading(heading + 180) },
    { label: "左方", heading: normalizeHeading(heading + 270) },
  ];
  let billableImages = 0;
  let billableGemini = 0;
  let imageCacheHits = 0;
  let geminiCacheHits = 0;

  const blocks: string[] = [];
  const scenes: Array<{ label: string; heading: number; description: string; imageUrl: string }> = [];

  for (const view of views) {
    const payload = {
      lat: round6(lat),
      lon: round6(lon),
      panoId: metadata.panoId,
      heading: view.heading,
      fov,
      pitch,
    };

    const imageCached = await getOrCreateCached(
      env,
      "streetview-image-v1",
      payload,
      async () => {
        const imageUrl = buildStreetViewUrl(mapsKey, { ...payload, language: "en" });
        const imageBytes = await fetchImageBytes(imageUrl);
        const imageObjectKey = await storeStreetViewImage(env, payload, imageBytes);
        return { imageUrl, imageObjectKey };
      },
      TTL_365_DAYS,
      {
        ctx,
        staleWhileRevalidateSeconds: 30 * DAY,
      },
    );

    if (imageCached.cacheHit) {
      imageCacheHits += 1;
    } else {
      billableImages += 1;
    }

    const textPayload = {
      ...payload,
      language,
    };

    let visionText = "未啟用 LLM 描述";
    if (useLlm) {
      const textCached = await getOrCreateCached(
        env,
        "streetview-gemini-text-v1",
        textPayload,
        async () => {
          const imageObjectKey = String((imageCached.data as Json).imageObjectKey || "").trim();
          if (!imageObjectKey) {
            throw new Error("Street View image cache key is missing");
          }
          const imageObj = await env.CACHE_BUCKET.get(imageObjectKey);
          if (!imageObj) {
            throw new Error("Street View image cache not found");
          }
          const imageBytes = new Uint8Array(await imageObj.arrayBuffer());
          const imageBase64 = bytesToBase64(imageBytes);
          const description = await fetchGeminiDescription(String(llmKey), imageBase64, language, {
            viewLabel: view.label,
            indoorLikely,
          });
          return { description };
        },
        TTL_365_DAYS,
        {
          ctx,
          staleWhileRevalidateSeconds: 30 * DAY,
        },
      );

      if (textCached.cacheHit) {
        geminiCacheHits += 1;
      } else {
        billableGemini += 1;
      }

      visionText = String((textCached.data as Json).description || "未取得完整描述");
    }
    const sceneImageUrl = String((imageCached.data as Json).imageUrl || "");
    blocks.push(`${view.label}：${visionText}`);
    scenes.push({ label: view.label, heading: view.heading, description: visionText, imageUrl: sceneImageUrl });
  }

  const estimatedCalls = views.length * (useLlm ? 2 : 1);
  const estimatedUsd = views.length * (PRICES.streetViewStatic + (useLlm ? PRICES.geminiGenerate : 0));
  const actualUsd = billableImages * PRICES.streetViewStatic + billableGemini * PRICES.geminiGenerate;

  await recordBilling(env, {
    provider: "streetview",
    cacheHit: billableImages + billableGemini === 0 ? 1 : 0,
    estimatedUsd,
    actualUsd,
    userId: clerkUser.userId,
  });

  const text = [
    indoorLikely ? "360 街景（疑似室內）詳細描述完成。" : "360 街景詳細描述完成。",
    `預估請求 ${estimatedCalls} 次，預估費用 $${estimatedUsd.toFixed(3)}。`,
    `Street View：新請求 ${billableImages} 次，圖片快取命中 ${imageCacheHits} 次。`,
    `LLM：新請求 ${billableGemini} 次，描述快取命中 ${geminiCacheHits} 次。`,
    `實際費用 $${actualUsd.toFixed(3)}。`,
    "",
    ...blocks,
  ].join("\n");

  return json({
    ok: true,
    provider: "streetview",
    hasStreetView: true,
    metadataStatus: metadata.status,
    indoorLikely,
    panorama: {
      panoId: metadata.panoId,
      lat: metadata.lat,
      lon: metadata.lon,
      heading: normalizeHeading(heading),
      copyright: metadata.copyright,
      date: metadata.date,
    },
    scenes,
    estimatedCalls,
    billableCalls: billableImages + billableGemini,
    cacheHits: imageCacheHits + geminiCacheHits,
    imageCacheHits,
    geminiCacheHits,
    billableImages,
    billableGemini,
    estimatedUsd,
    actualUsd,
    text,
  });
}

async function handleStreetViewMetadata(request: Request, env: Env): Promise<Response> {
  const body = await requireJson(request);
  const lat = Number(body.lat);
  const lon = Number(body.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error("lat and lon are required");
  }

  const mapsKey = requireGoogleMapsKey(env);
  const status = await fetchStreetViewMetadata(mapsKey, lat, lon);

  return json({
    ok: true,
    lat,
    lon,
    metadataStatus: status,
    hasStreetView: status === "OK",
  });
}

async function handlePaidStreetViewPanoramaDescribe(request: Request, env: Env): Promise<Response> {
  const clerkUser = await requireClerkAuth(request, env);
  const body = await requireJson(request);
  requireUserConfirmedPaidCall(body);

  const language = normalizeMapsLanguage(String(body.language || "zh-TW"));
  const rawImage = String(body.imageBase64 || "").trim();
  const imageBase64 = rawImage.includes(",") ? rawImage.split(",").pop() || "" : rawImage;

  if (!imageBase64 || imageBase64.length < 1000) {
    throw new Error("imageBase64 is required");
  }

  const geminiKey = requireGeminiKey(env);
  const description = await fetchGeminiPanoramaDescription(geminiKey, imageBase64, language);

  await recordBilling(env, {
    provider: "streetview-panorama-description",
    cacheHit: 0,
    estimatedUsd: PRICES.geminiGenerate,
    actualUsd: PRICES.geminiGenerate,
    userId: clerkUser.userId,
  });

  return json({
    ok: true,
    description,
    estimatedUsd: PRICES.geminiGenerate,
  });
}

async function handleCleanupNoImage(request: Request, env: Env): Promise<Response> {
  await requireAdminAuth(request, env);
  await ensureD1Schema(env);

  const body = await requireJson(request);
  const provider = String(body.provider || "streetview-image-v1").trim();
  if (!provider) {
    throw new Error("provider is required");
  }

  const list = await env.DB.prepare(
    "SELECT cache_key, object_key FROM api_cache WHERE provider = ?1",
  ).bind(provider).all<{ cache_key: string; object_key: string }>();

  const rows = Array.isArray(list.results) ? list.results : [];
  let deletedCount = 0;
  let scannedCount = 0;

  for (const row of rows) {
    scannedCount += 1;
    const obj = await env.CACHE_BUCKET.get(row.object_key);
    if (!obj) {
      continue;
    }

    let payload: Json | null = null;
    try {
      payload = (await obj.json()) as Json;
    } catch {
      payload = null;
    }
    if (!payload || payload.noImage !== true) {
      continue;
    }

    await env.CACHE_BUCKET.delete(row.object_key);
    await env.DB.prepare("DELETE FROM api_cache WHERE cache_key = ?1 AND provider = ?2")
      .bind(row.cache_key, provider)
      .run();
    const edgeReq = new Request(`https://cache.local/${provider}/${row.cache_key}`);
    await getEdgeCache().delete(edgeReq);
    deletedCount += 1;
  }

  return json({
    ok: true,
    provider,
    scannedCount,
    deletedNoImageCount: deletedCount,
  });
}

async function handleStreetViewStorageReport(request: Request, env: Env): Promise<Response> {
  await requireAdminAuth(request, env);
  await ensureD1Schema(env);
  await requireJson(request);

  const provider = "streetview-image-v1";
  const list = await env.DB.prepare(
    "SELECT cache_key, object_key FROM api_cache WHERE provider = ?1",
  ).bind(provider).all<{ cache_key: string; object_key: string }>();

  const rows = Array.isArray(list.results) ? list.results : [];
  let cacheEntryCount = 0;
  let missingCacheObjectCount = 0;
  let missingImageObjectCount = 0;
  let noImageEntryCount = 0;
  let totalBytes = 0;
  const seenImageObjectKeys = new Set<string>();

  const items: Array<{ cacheKey: string; imageObjectKey: string; bytes: number }> = [];

  for (const row of rows) {
    cacheEntryCount += 1;
    const cacheObj = await env.CACHE_BUCKET.get(row.object_key);
    if (!cacheObj) {
      missingCacheObjectCount += 1;
      continue;
    }

    const payload = (await cacheObj.json()) as Json;
    if (payload.noImage === true) {
      noImageEntryCount += 1;
      continue;
    }

    const imageObjectKey = String(payload.imageObjectKey || "").trim();
    if (!imageObjectKey || seenImageObjectKeys.has(imageObjectKey)) {
      continue;
    }

    const imageObj = await env.CACHE_BUCKET.get(imageObjectKey);
    if (!imageObj) {
      missingImageObjectCount += 1;
      continue;
    }

    const bytes = (await imageObj.arrayBuffer()).byteLength;
    totalBytes += bytes;
    seenImageObjectKeys.add(imageObjectKey);
    items.push({
      cacheKey: row.cache_key,
      imageObjectKey,
      bytes,
    });
  }

  return json({
    ok: true,
    provider,
    cacheEntryCount,
    imageObjectCount: seenImageObjectKeys.size,
    noImageEntryCount,
    missingCacheObjectCount,
    missingImageObjectCount,
    totalBytes,
    totalKilobytes: Number((totalBytes / 1024).toFixed(2)),
    items,
  });
}

async function handleAdminCacheStats(request: Request, env: Env): Promise<Response> {
  await requireAdminAuth(request, env);
  await ensureD1Schema(env);

  const now = nowEpoch();
  const rows = await env.DB.prepare(
    "SELECT provider, cache_key, object_key, expires_at, cache_meta FROM api_cache",
  ).all<{ provider: string; cache_key: string; object_key: string; expires_at: number; cache_meta: string | null }>();

  const items = Array.isArray(rows.results) ? rows.results : [];
  const byProvider = new Map<string, {
    provider: string;
    cacheEntryCount: number;
    expiredEntryCount: number;
    missingObjectCount: number;
    totalBytes: number;
  }>();

  for (const row of items) {
    const provider = String(row.provider || "unknown");
    const stat = byProvider.get(provider) || {
      provider,
      cacheEntryCount: 0,
      expiredEntryCount: 0,
      missingObjectCount: 0,
      totalBytes: 0,
    };
    stat.cacheEntryCount += 1;
    if (Number(row.expires_at) <= now) {
      stat.expiredEntryCount += 1;
    }

    const obj = await env.CACHE_BUCKET.get(row.object_key);
    if (!obj) {
      stat.missingObjectCount += 1;
      byProvider.set(provider, stat);
      continue;
    }

    const size = Number((obj as { size?: number }).size || 0);
    if (Number.isFinite(size) && size > 0) {
      stat.totalBytes += size;
    } else {
      stat.totalBytes += (await obj.arrayBuffer()).byteLength;
    }
    byProvider.set(provider, stat);
  }

  const providers = [...byProvider.values()]
    .map((item) => ({
      ...item,
      totalMiB: Number((item.totalBytes / (1024 * 1024)).toFixed(3)),
      totalGiB: Number((item.totalBytes / (1024 * 1024 * 1024)).toFixed(4)),
    }))
    .sort((a, b) => b.totalBytes - a.totalBytes);

  const totalBytes = providers.reduce((sum, item) => sum + item.totalBytes, 0);

  return json({
    ok: true,
    generatedAt: now,
    totals: {
      cacheEntryCount: items.length,
      totalBytes,
      totalMiB: Number((totalBytes / (1024 * 1024)).toFixed(3)),
      totalGiB: Number((totalBytes / (1024 * 1024 * 1024)).toFixed(4)),
    },
    limits: {
      d1StorageGiBFree: 5,
      r2StorageGiBFree: 10,
    },
    providers,
  });
}

async function handleAdminCachePurgeExpired(request: Request, env: Env): Promise<Response> {
  await requireAdminAuth(request, env);
  await ensureD1Schema(env);

  const body = await requireJson(request);
  const provider = String(body.provider || "").trim();
  const maxDelete = Math.max(1, Math.min(2000, Number(body.maxDelete ?? 500)));
  const now = nowEpoch();

  const sql = provider
    ? "SELECT provider, cache_key, object_key FROM api_cache WHERE provider = ?1 AND expires_at <= ?2 ORDER BY expires_at ASC LIMIT ?3"
    : "SELECT provider, cache_key, object_key FROM api_cache WHERE expires_at <= ?1 ORDER BY expires_at ASC LIMIT ?2";

  const rows = provider
    ? await env.DB.prepare(sql).bind(provider, now, maxDelete).all<{ provider: string; cache_key: string; object_key: string }>()
    : await env.DB.prepare(sql).bind(now, maxDelete).all<{ provider: string; cache_key: string; object_key: string }>();

  const items = Array.isArray(rows.results) ? rows.results : [];
  let deletedCount = 0;
  let deletedBytes = 0;

  for (const row of items) {
    const obj = await env.CACHE_BUCKET.get(row.object_key);
    if (obj) {
      const size = Number((obj as { size?: number }).size || 0);
      deletedBytes += Number.isFinite(size) && size > 0 ? size : (await obj.arrayBuffer()).byteLength;
    }

    await env.CACHE_BUCKET.delete(row.object_key);
    await env.DB.prepare("DELETE FROM api_cache WHERE cache_key = ?1 AND provider = ?2")
      .bind(row.cache_key, row.provider)
      .run();
    const edgeReq = new Request(`https://cache.local/${row.provider}/${row.cache_key}`);
    await getEdgeCache().delete(edgeReq);
    deletedCount += 1;
  }

  return json({
    ok: true,
    provider: provider || "all",
    maxDelete,
    matched: items.length,
    deletedCount,
    deletedBytes,
    deletedMiB: Number((deletedBytes / (1024 * 1024)).toFixed(3)),
  });
}

async function handleAdminCacheStreets(request: Request, env: Env): Promise<Response> {
  await requireAdminAuth(request, env);
  await ensureD1Schema(env);

  const now = nowEpoch();
  const rows = await env.DB.prepare(
    "SELECT provider, cache_key, object_key, expires_at, cache_meta FROM api_cache WHERE provider = ?1 ORDER BY expires_at ASC LIMIT 2000",
  ).bind("osm-segment-v2").all<{
    provider: string;
    cache_key: string;
    object_key: string;
    expires_at: number;
    cache_meta: string | null;
  }>();

  const items = Array.isArray(rows.results) ? rows.results : [];
  const grouped = new Map<string, {
    roadName: string;
    countryOrRegion: string;
    expiresAt: number;
    expiresInSeconds: number;
    status: string;
    mergedCount: number;
  }>();

  for (const row of items) {
    const meta = parseCacheMeta(row.cache_meta);
    const obj = await env.CACHE_BUCKET.get(row.object_key);
    const payload = obj ? ((await obj.json()) as Json) : {};

    const payloadRoadName = String(payload.roadName || payload.queryRoadName || "").trim();
    const metaRoadName = String(meta.roadName || meta.queryRoadName || "").trim();
    const roadName = payloadRoadName || metaRoadName || "(unknown road)";
    const country = resolveCacheCountry(meta, payload, roadName);
    const key = `${country}|${normalizeRoadName(roadName)}`;
    const expiresAt = Number(row.expires_at || 0);
    const expiresInSeconds = expiresAt - now;

    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        roadName,
        countryOrRegion: country,
        expiresAt,
        expiresInSeconds,
        status: expiresInSeconds > 0 ? "fresh-or-stale-window" : "expired",
        mergedCount: 1,
      });
      continue;
    }

    existing.mergedCount += 1;
    if (expiresAt > existing.expiresAt) {
      existing.expiresAt = expiresAt;
      existing.expiresInSeconds = expiresInSeconds;
      existing.status = expiresInSeconds > 0 ? "fresh-or-stale-window" : "expired";
    }
    if (roadName.length > existing.roadName.length) {
      existing.roadName = roadName;
    }
  }

  const entries: Array<{
    roadName: string;
    countryOrRegion: string;
    expiresAt: number;
    expiresInSeconds: number;
    status: string;
    mergedCount: number;
  }> = [...grouped.values()];

  entries.sort((a, b) => a.expiresInSeconds - b.expiresInSeconds);

  return json({
    ok: true,
    generatedAt: now,
    rawCount: items.length,
    count: entries.length,
    entries,
  });
}

function resolveCacheCountry(meta: Json, payload: Json, roadName: string): string {
  const direct = String(meta.countryCode || payload.countryCode || "").trim().toUpperCase();
  if (direct) {
    return direct;
  }

  const diagnostics = (payload.diagnostics || {}) as Json;
  const bbox = (diagnostics.initialBBox || diagnostics.finalBBox || {}) as Json;
  const south = Number(bbox.south);
  const west = Number(bbox.west);
  const north = Number(bbox.north);
  const east = Number(bbox.east);
  if ([south, west, north, east].every(Number.isFinite)) {
    const centerLat = (south + north) / 2;
    const centerLon = (west + east) / 2;
    if (centerLat >= 22 && centerLat <= 22.7 && centerLon >= 113.7 && centerLon <= 114.5) {
      return "HK";
    }
    if (centerLat >= 21.5 && centerLat <= 26 && centerLon >= 119 && centerLon <= 122.2) {
      return "TW";
    }
  }

  const normalized = normalizeRoadName(roadName);
  if (
    normalized.includes("香港") ||
    normalized.includes("九龍") ||
    normalized.includes("hongkong") ||
    normalized.includes("kowloon") ||
    normalized.includes("nathanroad") ||
    normalized.includes("彌敦道")
  ) {
    return "HK";
  }

  return "未設定";
}

function parseCacheMeta(raw: string | null): Json {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as Json;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
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
  const keys = ["name", "name:zh", "name:ja", "name:en", "official_name", "alt_name", "short_name"];
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
  const clerkUser = await requireClerkAuth(request, env);
  await ensureD1Schema(env);
  const body = await requireJson(request);
  requireUserConfirmedPaidCall(body);

  const start = body.start as Json;
  const end = body.end as Json;
  const intervalMeters = Number(body.intervalMeters ?? 50);
  const heading = Number(body.heading ?? 0);
  const language = normalizeMapsLanguage(String(body.language || "zh-TW"));

  const mapsKey = requireGoogleMapsKey(env);
  const geminiKey = requireGeminiKey(env);

  const points = sampleLineByMeters(
    { lat: Number(start.lat), lon: Number(start.lon) },
    { lat: Number(end.lat), lon: Number(end.lon) },
    intervalMeters,
  );

  let billableImages = 0;
  let billableGemini = 0;
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
      "route-scenery-gemini-v1",
      payload,
      async () => {
        const metaStatus = await fetchStreetViewMetadata(mapsKey, payload.lat, payload.lon);
        if (metaStatus === "ZERO_RESULTS" || metaStatus === "NOT_FOUND") {
          return { noImage: true, metadataStatus: metaStatus };
        }
        const imageUrl = buildStreetViewUrl(mapsKey, {
          lat: payload.lat,
          lon: payload.lon,
          heading: payload.heading,
          fov: payload.fov,
          pitch: payload.pitch,
          language,
        });
        const imageBytes = await fetchImageBytes(imageUrl);
        const imageBase64 = bytesToBase64(imageBytes);
        const description = await fetchGeminiDescription(geminiKey, imageBase64, language);
        return { imageUrl, description };
      },
      TTL_365_DAYS,
    );

    if (cached.cacheHit) {
      cacheHits += 1;
    } else if (!(cached.data as Json).noImage) {
      billableImages += 1;
      billableGemini += 1;
    }

    const text = (cached.data as Json).noImage
      ? `此地點無 Street View 覆蓋（${(cached.data as Json).metadataStatus}）`
      : String((cached.data as Json).description || "未取得完整描述");
    lines.push(`${distance}m：${text}`);
  }

  const estimatedCalls = points.length * 2;
  const estimatedUsd = points.length * (PRICES.streetViewStatic + PRICES.geminiGenerate);
  const actualUsd = billableImages * PRICES.streetViewStatic + billableGemini * PRICES.geminiGenerate;

  await recordBilling(env, {
    provider: "route-scenery",
    cacheHit: billableImages === 0 ? 1 : 0,
    estimatedUsd,
    actualUsd,
    userId: clerkUser.userId,
  });

  const text = [
    `沿路景物描述完成，每 ${intervalMeters}m 採樣，共 ${points.length} 點。`,
    `預估請求 ${estimatedCalls} 次，預估費用 $${estimatedUsd.toFixed(3)}。`,
    `實際計費影像 ${billableImages} 次，LLM ${billableGemini} 次，cache 命中 ${cacheHits} 次。`,
    `實際費用 $${actualUsd.toFixed(3)}。`,
    "",
    ...lines,
  ].join("\n");

  return json({
    ok: true,
    provider: "route-scenery",
    estimatedCalls,
    billableCalls: billableImages + billableGemini,
    cacheHits,
    estimatedUsd,
    actualUsd,
    text,
  });
}

function buildStreetViewUrl(
  apiKey: string,
  args: { lat: number; lon: number; heading: number; fov: number; pitch: number; language: string; panoId?: string | null },
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
  if (args.panoId) {
    p.set("pano", args.panoId);
  }
  return `https://maps.googleapis.com/maps/api/streetview?${p.toString()}`;
}

async function fetchStreetViewMetadata(apiKey: string, lat: number, lon: number, source?: "outdoor"): Promise<string> {
  try {
    const p = new URLSearchParams({ location: `${lat},${lon}`, key: apiKey });
    if (source) {
      p.set("source", source);
    }
    const url = `https://maps.googleapis.com/maps/api/streetview/metadata?${p.toString()}`;
    const res = await fetchWithTimeout(url, {}, 8000);
    if (!res.ok) return "API_ERROR";
    const body = (await res.json()) as Json;
    return String(body.status || "UNKNOWN");
  } catch {
    return "API_ERROR";
  }
}

type StreetViewMetadataDetails = {
  status: string;
  panoId: string | null;
  lat: number;
  lon: number;
  copyright: string | null;
  date: string | null;
};

async function fetchStreetViewMetadataDetails(apiKey: string, lat: number, lon: number): Promise<StreetViewMetadataDetails> {
  try {
    const p = new URLSearchParams({ location: `${lat},${lon}`, key: apiKey });
    const url = `https://maps.googleapis.com/maps/api/streetview/metadata?${p.toString()}`;
    const res = await fetchWithTimeout(url, {}, 8000);
    if (!res.ok) {
      return { status: "API_ERROR", panoId: null, lat, lon, copyright: null, date: null };
    }

    const body = (await res.json()) as Json;
    const location = (body.location || {}) as Json;
    return {
      status: String(body.status || "UNKNOWN"),
      panoId: String(body.pano_id || "").trim() || null,
      lat: Number.isFinite(Number(location.lat)) ? Number(location.lat) : lat,
      lon: Number.isFinite(Number(location.lng)) ? Number(location.lng) : lon,
      copyright: String(body.copyright || "").trim() || null,
      date: String(body.date || "").trim() || null,
    };
  } catch {
    return { status: "API_ERROR", panoId: null, lat, lon, copyright: null, date: null };
  }
}

async function detectIndoorPanoramaLikely(apiKey: string, meta: StreetViewMetadataDetails): Promise<boolean> {
  const sourceText = `${meta.copyright || ""} ${meta.panoId || ""}`.toLowerCase();
  const vendorIndoorHints = ["metro", "station", "mall", "airport", "jr", "rail", "terminal", "subway"];
  if (vendorIndoorHints.some((hint) => sourceText.includes(hint))) {
    return true;
  }

  const outdoorStatus = await fetchStreetViewMetadata(apiKey, meta.lat, meta.lon, "outdoor");
  return meta.status === "OK" && (outdoorStatus === "ZERO_RESULTS" || outdoorStatus === "NOT_FOUND");
}

async function detectIndoorPanoramaLikelyByPanoId(apiKey: string, panoId: string): Promise<boolean> {
  // For panoId-only detection, check if the panoId itself contains indoor hints
  const sourceText = panoId.toLowerCase();
  const vendorIndoorHints = ["metro", "station", "mall", "airport", "jr", "rail", "terminal", "subway", "indoor"];
  return vendorIndoorHints.some((hint) => sourceText.includes(hint));
}

async function fetchImageBytes(imageUrl: string): Promise<Uint8Array> {
  const res = await fetchWithTimeout(imageUrl, {}, 15000);
  if (!res.ok) {
    throw new Error(`Street View image fetch failed: HTTP ${res.status}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

async function storeStreetViewImage(
  env: Env,
  payload: { lat: number; lon: number; heading: number; fov: number; pitch: number },
  bytes: Uint8Array,
): Promise<string> {
  const key = await buildCacheKey("streetview-image-bytes-v1", payload);
  const objectKey = `streetview-images/${key}.jpg`;
  await env.CACHE_BUCKET.put(objectKey, bytes, {
    httpMetadata: {
      contentType: "image/jpeg",
      cacheControl: `max-age=${CACHE_MAX_AGE_SECONDS}`,
    },
  });
  return objectKey;
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize) as unknown as number[]);
  }
  return btoa(binary);
}

async function fetchGooglePlaces(
  apiKey: string,
  lat: number,
  lon: number,
  radius: number,
  language: string,
): Promise<Json> {
  const url = "https://places.googleapis.com/v1/places:searchNearby";
  const reqBody = {
    languageCode: language,
    maxResultCount: 15,
    locationRestriction: {
      circle: {
        center: {
          latitude: lat,
          longitude: lon,
        },
        radius: Math.max(1, Math.min(50000, radius)),
      },
    },
  };

  // Essentials-only fields to stay in Nearby Search (New) Essentials SKU.
  const fieldMask = [
    "places.displayName",
    "places.formattedAddress",
    "places.types",
    "places.location",
  ].join(",");

  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": fieldMask,
      },
      body: JSON.stringify(reqBody),
    },
    10000,
  );
  if (!res.ok) {
    throw new Error(`Google Places error: ${res.status}`);
  }

  const jsonBody = (await res.json()) as Json;
  const places = Array.isArray(jsonBody.places) ? (jsonBody.places as Json[]) : [];
  if (!Array.isArray(places)) {
    throw new Error("Google Places response malformed");
  }
  return { places };
}

function normalizeMapsLanguage(value: string): string {
  const v = value.trim().toLowerCase();
  if (v.startsWith("en")) return "en";
  if (v.startsWith("ja")) return "ja";
  if (v.startsWith("ko")) return "ko";
  return "zh-TW";
}

async function fetchGeminiDescription(
  apiKey: string,
  imageBase64: string,
  language: string,
  options?: { viewLabel?: string; indoorLikely?: boolean },
): Promise<string> {
  const viewLabel = String(options?.viewLabel || "").trim();
  const prompt = [
    `Please answer in ${language} and provide 1 to 3 complete sentences.`,
    viewLabel ? `Current panorama direction: ${viewLabel}.` : "",
    "Focus on: shops, shop names, building, and traffic lights/pedestrian facilities (omit this part if none are visible).",
    options?.indoorLikely
      ? "This panorama is likely indoor; prioritize indoor wayfinding landmarks such as exits, gates, stairs, escalators, elevators, platforms, and corridor branching."
      : "",
    "If uncertain, clearly say it may be the case or cannot be fully confirmed.",
    "Do not output lists or JSON.",
  ].filter(Boolean).join("\n");

  const reqBody = {
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: imageBase64,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 240,
    },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(reqBody),
    },
    30000,
  );

  const body = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok) {
    const errMsg = extractGoogleErrorMessage(body) || `HTTP ${res.status}`;
    throw new Error(`LLM 失敗：${errMsg}`);
  }

  const candidates = Array.isArray(body.candidates) ? (body.candidates as Json[]) : [];
  const first = candidates[0] || {};
  const content = (first.content || {}) as Json;
  const parts = Array.isArray(content.parts) ? (content.parts as Json[]) : [];
  const text = parts.map((p) => String(p.text || "").trim()).filter(Boolean).join("\n").trim();
  if (!text) {
    throw new Error("LLM 回傳內容為空");
  }
  return text;
}

async function fetchGeminiPanoramaDescription(
  apiKey: string,
  imageBase64: string,
  language: string,
): Promise<string> {
  const prompt = [
    `Please answer in ${language} and provide 2 to 4 complete sentences.`,
    "This is a stitched 360-degree indoor panorama strip (left-to-right sequence of multiple directions).",
    "Describe the surrounding environment for blind or low-vision wayfinding users.",
    "Focus on practical landmarks: exits, stairs/escalators/elevators, gates, counters, corridor branching, and readable signs.",
    "If a detail is uncertain, explicitly state uncertainty.",
    "Do not output lists or JSON.",
  ].join("\n");

  const reqBody = {
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: imageBase64,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 320,
    },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(reqBody),
    },
    30000,
  );

  const body = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok) {
    const errMsg = extractGoogleErrorMessage(body) || `HTTP ${res.status}`;
    throw new Error(`LLM 失敗：${errMsg}`);
  }

  const candidates = Array.isArray(body.candidates) ? (body.candidates as Json[]) : [];
  const first = candidates[0] || {};
  const content = (first.content || {}) as Json;
  const parts = Array.isArray(content.parts) ? (content.parts as Json[]) : [];
  const text = parts.map((p) => String(p.text || "").trim()).filter(Boolean).join("\n").trim();
  if (!text) {
    throw new Error("LLM 回傳內容為空");
  }
  return text;
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


// ── New API handlers ───────────────────────────────────────────────────────
async function handleMe(request: Request, env: Env): Promise<Response> {
  const secretKey = env.CLERK_SECRET_KEY || "";
  const host = new URL(request.url).hostname.toLowerCase();
  const isDev = host === "127.0.0.1" || host === "localhost";
  if (isDev && !secretKey) {
    return json({ signedIn: true, approved: true, email: "dev@local", isAdmin: true });
  }
  const authHeader = request.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ signedIn: false, approved: false });
  }
  const token = authHeader.slice(7);
  const verified = await verifyClerkToken(token);
  if (!verified) {
    return json({ signedIn: false, approved: false });
  }
  if (!secretKey) {
    return json({ signedIn: true, approved: false, email: "" });
  }
  const meta = await getClerkUserMeta(verified.userId, secretKey);
  return json({ signedIn: true, approved: meta.approved, email: meta.email, isAdmin: meta.isAdmin });
}

async function handleBillingSummary(request: Request, env: Env): Promise<Response> {
  const user = await requireClerkAuth(request, env);
  await ensureD1Schema(env);

  const total = await env.DB.prepare(
    "SELECT COUNT(*) AS events, COALESCE(SUM(estimated_usd), 0) AS estimated, COALESCE(SUM(actual_usd), 0) AS actual FROM billing_events WHERE user_id = ?1",
  )
    .bind(user.userId)
    .first<{ events: number; estimated: number; actual: number }>();

  const byProviderRaw = await env.DB.prepare(
    "SELECT provider, COUNT(*) AS events, COALESCE(SUM(estimated_usd),0) AS estimated, COALESCE(SUM(actual_usd),0) AS actual FROM billing_events WHERE user_id = ?1 GROUP BY provider ORDER BY actual DESC",
  )
    .bind(user.userId)
    .all<{ provider: string; events: number; estimated: number; actual: number }>();

  return json({
    ok: true,
    userId: user.userId,
    totals: {
      events: Number(total?.events || 0),
      estimatedUsd: Number(total?.estimated || 0),
      actualUsd: Number(total?.actual || 0),
    },
    byProvider: Array.isArray(byProviderRaw.results) ? byProviderRaw.results : [],
  });
}

async function handleAdminListUsers(request: Request, env: Env): Promise<Response> {
  await requireAdminAuth(request, env);
  const secretKey = env.CLERK_SECRET_KEY || "";
  if (!secretKey) throw new Error("Authentication not configured");
  const res = await fetchWithTimeout(
    "https://api.clerk.com/v1/users?limit=100&order_by=-created_at",
    { headers: { Authorization: `Bearer ${secretKey}` } },
    8000,
  );
  if (!res.ok) throw new Error(`Failed to list users`);
  const users = (await res.json()) as Array<{
    id: string;
    email_addresses: Array<{ email_address: string }>;
    public_metadata?: { approved?: boolean; role?: string };
    created_at: number;
  }>;
  const result = users.map((u) => {
    const email = u.email_addresses?.[0]?.email_address || "";
    return {
      userId: u.id,
      email,
      approved: u.public_metadata?.approved === true,
      isAdmin: u.public_metadata?.role === "admin" || BUILTIN_ADMIN_EMAILS.has(email.toLowerCase()),
      createdAt: u.created_at,
    };
  });
  return json({ ok: true, users: result });
}

async function handleAdminApproveUser(request: Request, env: Env): Promise<Response> {
  await requireAdminAuth(request, env);
  const body = await requireJson(request);
  const targetUserId = String(body.userId || "").trim();
  const approve = body.approve !== false;
  if (!targetUserId) throw new Error("userId is required");
  const secretKey = env.CLERK_SECRET_KEY || "";
  if (!secretKey) throw new Error("Authentication not configured");
  const res = await fetchWithTimeout(
    `https://api.clerk.com/v1/users/${encodeURIComponent(targetUserId)}/metadata`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ public_metadata: { approved: approve } }),
    },
    8000,
  );
  if (!res.ok) {
    throw new Error(`Failed to update user`);
  }
  // Invalidate edge cache for this user
  await getEdgeCache().delete(new Request(`https://cache.local/clerk-user-meta/${targetUserId}`));
  return json({ ok: true, userId: targetUserId, approved: approve });
}

async function handleAdminBillingSummary(request: Request, env: Env): Promise<Response> {
  await requireAdminAuth(request, env);
  await ensureD1Schema(env);

  const rows = await env.DB.prepare(
    "SELECT user_id, COUNT(*) AS events, COALESCE(SUM(estimated_usd),0) AS estimated, COALESCE(SUM(actual_usd),0) AS actual, MAX(created_at) AS last_event_at FROM billing_events GROUP BY user_id ORDER BY actual DESC",
  ).all<{ user_id: string; events: number; estimated: number; actual: number; last_event_at: number }>();

  const totals = await env.DB.prepare(
    "SELECT COUNT(*) AS events, COALESCE(SUM(estimated_usd),0) AS estimated, COALESCE(SUM(actual_usd),0) AS actual FROM billing_events",
  ).first<{ events: number; estimated: number; actual: number }>();

  return json({
    ok: true,
    totals: {
      events: Number(totals?.events || 0),
      estimatedUsd: Number(totals?.estimated || 0),
      actualUsd: Number(totals?.actual || 0),
    },
    users: Array.isArray(rows.results)
      ? rows.results.map((r) => ({
          userId: r.user_id,
          events: Number(r.events || 0),
          estimatedUsd: Number(r.estimated || 0),
          actualUsd: Number(r.actual || 0),
          lastEventAt: Number(r.last_event_at || 0),
        }))
      : [],
  });
}

async function resolveRoadBBox(
  roadName: string,
  countryCode: string,
  focusPoint?: { lat: number; lon: number },
): Promise<{ bbox: BBox }> {
  // If a trusted focus point was provided by the caller (e.g. already geocoded on the client),
  // derive a sensible bbox from it directly and skip the Nominatim round-trip.
  if (focusPoint && Number.isFinite(focusPoint.lat) && Number.isFinite(focusPoint.lon)) {
    const radius = 0.012;
    return {
      bbox: {
        south: focusPoint.lat - radius,
        north: focusPoint.lat + radius,
        west: focusPoint.lon - radius,
        east: focusPoint.lon + radius,
      },
    };
  }

  const normalizedCountry = /^[a-z]{2}$/.test(countryCode) ? countryCode : "";
  let items: Array<Record<string, unknown>> = [];

  if (normalizedCountry === "hk") {
    const hkItems = await fetchNominatimSearch(roadName, "hk");
    if (hkItems.length > 0) {
      items = hkItems;
    } else {
      for (const q of [`香港${roadName}`, `Hong Kong ${roadName}`, roadName]) {
        const cnItems = await fetchNominatimSearch(q, "cn");
        if (cnItems.length > 0) {
          items = cnItems;
          break;
        }
      }
    }
  } else if (normalizedCountry) {
    const queryVariants = buildQueryVariants(roadName);
    for (const q of queryVariants) {
      const filteredItems = await fetchNominatimSearch(q, normalizedCountry);
      if (filteredItems.length > 0) {
        items = filteredItems;
        break;
      }
    }
    // Fallback: try without country filter
    if (!items.length) {
      for (const q of queryVariants) {
        const anyItems = await fetchNominatimSearch(q, "");
        if (anyItems.length > 0) {
          items = anyItems;
          break;
        }
      }
    }
  } else {
    items = await fetchNominatimSearch(roadName, "");
  }

  if (!items.length) {
    throw new Error(`Geocode no result for road name "${roadName}" (country: ${countryCode || "any"})`);
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
    validateCoordinates(lat, lon);
    const radius = 0.008;
    south = lat - radius;
    north = lat + radius;
    west = lon - radius;
    east = lon + radius;
  }

  return { bbox: { south, west, north, east } };
}

// ── Indoor Navigation: Resolve Pano + Links ───────────────────────────────
async function handleResolveStreetViewPano(request: Request, env: Env): Promise<Response> {
  const body = await requireJson(request);
  const lat = Number(body.lat);
  const lon = Number(body.lon);
  const panoId = String(body.panoId || "").trim() || null;

  if (!panoId && (!Number.isFinite(lat) || !Number.isFinite(lon))) {
    throw new Error("panoId or (lat,lon) is required");
  }

  const mapsKey = requireGoogleMapsKey(env);
  
  let resolvedLat = lat;
  let resolvedLon = lon;
  let resolvedPanoId = panoId;
  let copyright: string | null = null;
  let date: string | null = null;

  // If no panoId, resolve from coordinates first
  if (!resolvedPanoId) {
    const meta = await fetchStreetViewMetadataDetails(mapsKey, round6(lat), round6(lon));
    if (meta.status !== "OK") {
      return json({
        ok: false,
        error: `No Street View at ${lat},${lon}: ${meta.status}`,
      });
    }
    resolvedPanoId = meta.panoId;
    resolvedLat = meta.lat;
    resolvedLon = meta.lon;
    copyright = meta.copyright;
    date = meta.date;
  } else {
    // If panoId provided, still fetch metadata to get coordinates
    const meta = await fetchStreetViewMetadataDetails(mapsKey, round6(lat || 0), round6(lon || 0));
    if (meta.panoId === resolvedPanoId) {
      resolvedLat = meta.lat;
      resolvedLon = meta.lon;
      copyright = meta.copyright;
      date = meta.date;
    }
  }

  if (!resolvedPanoId) {
    return json({
      ok: false,
      error: "Could not resolve pano ID",
    });
  }

  // For now, return basic pano info without real links (since Metadata API doesn't expose links directly)
  // In a production system, you'd use JS API on frontend to get links, or store them separately
  const isIndoor = await detectIndoorPanoramaLikely(mapsKey, {
    status: "OK",
    panoId: resolvedPanoId,
    lat: resolvedLat,
    lon: resolvedLon,
    copyright,
    date,
  });

  const node: PanoNode = {
    panoId: resolvedPanoId,
    lat: resolvedLat,
    lon: resolvedLon,
    levelLabel: null,
    links: [], // Will be populated by frontend using JS API
    copyright,
    date,
    isIndoor,
    providerHint: extractProviderFromCopyright(copyright),
  };

  return json({
    ok: true,
    node,
  });
}

async function handleFindNearbyIndoorEntry(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await requireJson(request);
  const lat = Number(body.lat);
  const lon = Number(body.lon);
  const radiusMeters = Math.max(40, Math.min(300, Number(body.radiusMeters ?? 220)));

  validateCoordinates(lat, lon);
  const mapsKey = requireGoogleMapsKey(env);

  const origin = { lat: round6(lat), lon: round6(lon) };
  const cachePayload: Json = {
    lat: origin.lat,
    lon: origin.lon,
    radiusMeters,
  };

  const cached = await getOrCreateCached(
    env,
    "streetview-indoor-entry-v2",
    cachePayload,
    async () => {
      const rings = [0, 30, 80, 140, radiusMeters].filter((d, i, arr) => arr.indexOf(d) === i);
      const headings = [0, 90, 180, 270];
      let checked = 0;
      const scored: Array<{
        score: number;
        distanceMeters: number;
        panoId: string;
        lat: number;
        lon: number;
        indoor: boolean;
        copyright: string | null;
        date: string | null;
        providerHint: string | null;
      }> = [];
      const seen = new Set<string>();

      for (const ring of rings) {
        if (ring > radiusMeters) continue;
        const points =
          ring === 0 ? [origin] : headings.map((h) => offsetPointByMeters(origin, normalizeHeading(h), ring));

        for (const p of points) {
          const meta = await fetchStreetViewMetadataDetails(mapsKey, round6(p.lat), round6(p.lon));
          if (meta.status !== "OK" || !meta.panoId || seen.has(meta.panoId)) continue;
          seen.add(meta.panoId);

          checked += 1;
          const text = `${meta.panoId || ""} ${meta.copyright || ""}`.toLowerCase();
          const indoor = hasIndoorHintText(text);
          const actualDistance = Math.round(haversineMeters(origin, { lat: meta.lat, lon: meta.lon }));
          const stationBonus = hasStationHintText(text) ? 200 : 0;
          const score = (indoor ? 1000 : 0) + stationBonus - actualDistance;

          scored.push({
            score,
            distanceMeters: actualDistance,
            panoId: meta.panoId,
            lat: meta.lat,
            lon: meta.lon,
            indoor,
            copyright: meta.copyright,
            date: meta.date,
            providerHint: extractProviderFromCopyright(meta.copyright),
          });
        }
      }

      scored.sort((a, b) => b.score - a.score || a.distanceMeters - b.distanceMeters);
      const top = scored.slice(0, 3);

      if (!top.length) {
        return {
          ok: true,
          found: false,
          checked,
          error: "No nearby Street View panorama found",
        } as Json;
      }

      const toNode = (item: {
        panoId: string;
        lat: number;
        lon: number;
        indoor: boolean;
        copyright: string | null;
        date: string | null;
        providerHint: string | null;
      }): PanoNode => ({
        panoId: item.panoId,
        lat: round6(item.lat),
        lon: round6(item.lon),
        levelLabel: null,
        links: [],
        copyright: item.copyright,
        date: item.date,
        isIndoor: item.indoor,
        providerHint: item.providerHint,
      });

      const best = top[0];
      const second = top[1] || null;
      const confidence = estimateIndoorEntryConfidence(best, second);
      const node = toNode(best);
      const candidates = top.map((item, index) => ({
        rank: index + 1,
        distanceMeters: item.distanceMeters,
        indoor: item.indoor,
        score: item.score,
        node: toNode(item),
        bearing: Math.round(calculateBearing(lat, lon, item.lat, item.lon)),
      }));

      return {
        ok: true,
        found: true,
        checked,
        distanceMeters: best.distanceMeters,
        confidence,
        confidenceLevel: confidenceToLevel(confidence),
        fallbackToManual: confidence < 0.5,
        node,
        candidates,
      } as Json;
    },
    30 * DAY,
    { ctx, staleWhileRevalidateSeconds: 7 * DAY },
  );

  return json(cached.data);
}

async function handleIndoorStepDecision(request: Request): Promise<Response> {
  const body = await requireJson(request);
  const targetBearing = normalizeHeading(Number(body.targetBearing ?? 0));
  const stepMeters = Math.max(1, Math.min(30, Number(body.stepMeters ?? 5)));
  const currentLat = Number(body.currentLat);
  const currentLon = Number(body.currentLon);
  const rawLinks = Array.isArray(body.links) ? (body.links as Json[]) : [];

  const links = rawLinks
    .map((it) => ({
      panoId: String(it.panoId || "").trim(),
      heading: Number(it.heading),
      description: String(it.description || "").trim(),
      label: String(it.label || "").trim(),
    }))
    .filter((it) => it.panoId && Number.isFinite(it.heading));

  if (links.length > 0) {
    let best = links[0];
    let bestDelta = Math.abs(signedBearingDelta(targetBearing, links[0].heading));
    for (let i = 1; i < links.length; i += 1) {
      const delta = Math.abs(signedBearingDelta(targetBearing, links[i].heading));
      if (delta < bestDelta) {
        best = links[i];
        bestDelta = delta;
      }
    }

    const confidence = bestDelta <= 25 ? 0.9 : bestDelta <= 55 ? 0.66 : 0.38;
    const decision: IndoorStepDecision = {
      mode: "link",
      confidence,
      confidenceLevel: confidenceToLevel(confidence),
      fallbackToManual: confidence < 0.5,
      reason: "best_link_by_heading_delta",
      selectedLink: {
        panoId: best.panoId,
        heading: Math.round(normalizeHeading(best.heading)),
        description: best.description,
        label: best.label || best.description || "前往",
        delta: Math.round(bestDelta),
      },
    };
    return json({ ok: true, decision });
  }

  if (Number.isFinite(currentLat) && Number.isFinite(currentLon)) {
    const target = offsetPointByMeters({ lat: currentLat, lon: currentLon }, targetBearing, stepMeters);
    const confidence = 0.42;
    const decision: IndoorStepDecision = {
      mode: "offset",
      confidence,
      confidenceLevel: confidenceToLevel(confidence),
      fallbackToManual: true,
      reason: "no_links_offset_fallback",
      target: {
        lat: round6(target.lat),
        lon: round6(target.lon),
      },
    };
    return json({ ok: true, decision });
  }

  const decision: IndoorStepDecision = {
    mode: "manual",
    confidence: 0.2,
    confidenceLevel: "low",
    fallbackToManual: true,
    reason: "insufficient_indoor_data",
  };
  return json({ ok: true, decision });
}

function confidenceToLevel(confidence: number): "high" | "medium" | "low" {
  if (confidence >= 0.75) return "high";
  if (confidence >= 0.5) return "medium";
  return "low";
}

function estimateIndoorEntryConfidence(
  best: { score: number; distanceMeters: number; indoor: boolean },
  second: { score: number } | null,
): number {
  let confidence = best.indoor ? 0.82 : 0.58;
  if (best.distanceMeters > 120) confidence -= 0.15;
  if (second && best.score - second.score < 80) confidence -= 0.2;
  return Math.max(0.15, Math.min(0.95, confidence));
}

// ── Analyze Link with LLM CV ────────────────────────────────────────────
async function handleAnalyzeStreetViewLink(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const clerkUser = await requireClerkAuth(request, env);
  const body = await requireJson(request);
  requireUserConfirmedPaidCall(body);

  const panoId = String(body.panoId || "").trim();
  const heading = Number(body.heading ?? 0);
  const description = String(body.description || "").trim();
  const fov = Number(body.fov ?? 90);
  const pitch = Number(body.pitch ?? 0);
  const language = normalizeMapsLanguage(String(body.language || "zh-TW"));

  if (!panoId) {
    throw new Error("panoId is required");
  }

  const mapsKey = requireGoogleMapsKey(env);
  const geminiKey = requireGeminiKey(env);

  // Build image URL using panoId directly
  const imageUrl = buildStreetViewUrl(mapsKey, {
    lat: 0,
    lon: 0,
    heading,
    fov,
    pitch,
    language: "en",
    panoId,
  });

  try {
    const imageBytes = await fetchImageBytes(imageUrl);
    const imageBase64 = bytesToBase64(imageBytes);

    // Analyze with LLM for indoor wayfinding features
    const cvPrompt = [
      `Please answer in ${language} in 1-2 sentences.`,
      `Looking at this direction (bearing: ${Math.round(heading)}°, description: "${description}"),`,
      `identify what type of indoor wayfinding feature appears (e.g., staircase, escalator, elevator, exit sign, gate, corridor, ticket counter, platform).`,
      `Also note if it's labeled "剪票口" (ticket gate) specifically, or any signage visible.`,
      `Be concise and factual only.`,
    ].join(" ");

    const reqBody = {
      contents: [
        {
          role: "user",
          parts: [
            { text: cvPrompt },
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: imageBase64,
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 120,
      },
    };

    const res = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${encodeURIComponent(geminiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reqBody),
      },
      30000,
    );

    const result = (await res.json().catch(() => ({}))) as Json;
    if (!res.ok) {
      const errMsg = extractGoogleErrorMessage(result) || `HTTP ${res.status}`;
      throw new Error(`LLM analysis failed: ${errMsg}`);
    }

    const candidates = Array.isArray(result.candidates) ? (result.candidates as Json[]) : [];
    const first = candidates[0] || {};
    const content = (first.content || {}) as Json;
    const parts = Array.isArray(content.parts) ? (content.parts as Json[]) : [];
    const cvText = parts.map((p) => String(p.text || "").trim()).filter(Boolean).join("\n").trim();

    // Bill for CV analysis
    await recordBilling(env, {
      provider: "streetview-cv-analysis",
      cacheHit: 0,
      estimatedUsd: PRICES.geminiGenerate,
      actualUsd: PRICES.geminiGenerate,
      userId: clerkUser.userId,
    });

    const label = generateLinkLabel(heading, description, cvText);

    return json({
      ok: true,
      panoId,
      heading,
      description,
      cvAnalysis: cvText,
      label,
      estimatedUsd: PRICES.geminiGenerate,
    });
  } catch (err) {
    throw new Error(`Link analysis error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handleGetMapsKey(request: Request, env: Env): Promise<Response> {
  // Return Google Maps API key for frontend use only (restricted to JS API)
  const apiKey = requireGoogleMapsKey(env);
  return json({
    ok: true,
    apiKey,
  });
}

function extractProviderFromCopyright(copyright: string | null): string | null {
  if (!copyright) return null;
  const lower = copyright.toLowerCase();
  if (lower.includes("jreast") || lower.includes("jr east")) return "JR East";
  if (lower.includes("tokyo metro") || lower.includes("tokyometro")) return "Tokyo Metro";
  if (lower.includes("metro")) return "Metro";
  if (lower.includes("mtr") || lower.includes("hong kong")) return "MTR";
  return null;
}

function generateLinkLabel(heading: number, description: string, cvText: string): string {
  const dir = bearingToRelativeDir(heading);
  const featureFromCV = extractFeatureFromCV(cvText);
  const feature = featureFromCV || normalizeDescription(description);
  return `${dir}${feature ? ` ${feature}` : ""}`;
}

function bearingToRelativeDir(bearing: number): string {
  const normalized = ((bearing % 360) + 360) % 360;
  const dirs = ["前方", "右前方", "右方", "右後方", "後方", "左後方", "左方", "左前方"];
  const idx = Math.round(normalized / 45) % 8;
  return dirs[idx];
}

function extractFeatureFromCV(cvText: string): string | null {
  const text = cvText.toLowerCase();
  if (text.includes("剪票口") || text.includes("ticket") || text.includes("gate")) return "剪票口";
  if (text.includes("楼梯") || text.includes("stair")) return "樓梯";
  if (text.includes("电梯") || text.includes("elevator")) return "電梯";
  if (text.includes("扶梯") || text.includes("escalator")) return "扶梯";
  if (text.includes("出口") || text.includes("exit")) return "出口";
  if (text.includes("通道") || text.includes("corridor")) return "通道";
  if (text.includes("平台") || text.includes("platform")) return "月台";
  return null;
}

function normalizeDescription(desc: string): string {
  const lower = desc.toLowerCase();
  const map: Record<string, string> = {
    staircase: "樓梯",
    stair: "樓梯",
    elevator: "電梯",
    escalator: "扶梯",
    corridor: "通道",
    passage: "通道",
    exit: "出口",
    platform: "月台",
    gate: "剪票口",
    north: "北",
    northeast: "東北",
    east: "東",
    southeast: "東南",
    south: "南",
    southwest: "西南",
    west: "西",
    northwest: "西北",
  };
  for (const [key, label] of Object.entries(map)) {
    if (lower.includes(key)) {
      return label;
    }
  }
  return "";
}

function hasIndoorHintText(text: string): boolean {
  const hints = ["station", "metro", "subway", "rail", "jr", "terminal", "mall", "airport", "indoor"];
  return hints.some((hint) => text.includes(hint));
}

function hasStationHintText(text: string): boolean {
  const hints = ["station", "tokyo", "jr", "rail", "metro", "subway", "platform", "yaesu", "marunouchi"];
  return hints.some((hint) => text.includes(hint));
}

function offsetPointByMeters(origin: { lat: number; lon: number }, bearingDeg: number, meters: number): {
  lat: number;
  lon: number;
} {
  const R = 6_371_000;
  const delta = meters / R;
  const theta = (bearingDeg * Math.PI) / 180;
  const phi1 = (origin.lat * Math.PI) / 180;
  const lambda1 = (origin.lon * Math.PI) / 180;

  const phi2 = Math.asin(Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta));
  const lambda2 =
    lambda1 + Math.atan2(Math.sin(theta) * Math.sin(delta) * Math.cos(phi1), Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2));

  return {
    lat: (phi2 * 180) / Math.PI,
    lon: (lambda2 * 180) / Math.PI,
  };
}

async function handleClerkWebhook(request: Request, env: Env): Promise<Response> {
  const webhookSecret = env.CLERK_WEBHOOK_SECRET || "";
  const rawBody = await request.text();
  if (webhookSecret) {
    const signatureOk = await verifySvixWebhook(request.headers, rawBody, webhookSecret);
    if (!signatureOk) {
      return json({ error: "Invalid webhook signature" }, 400);
    }
  }
  const payload = JSON.parse(rawBody) as Json;
  const eventType = String(payload.type || "");
  if (eventType === "user.created") {
    const userId = String((payload.data as Json)?.id || "");
    if (userId && env.CLERK_SECRET_KEY) {
      await fetchWithTimeout(
        `https://api.clerk.com/v1/users/${encodeURIComponent(userId)}/metadata`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${env.CLERK_SECRET_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ public_metadata: { approved: false } }),
        },
        8000,
      ).catch(() => null);
    }
  }
  return json({ ok: true, event: eventType });
}

async function verifySvixWebhook(headers: Headers, body: string, secret: string): Promise<boolean> {
  const svixId = String(headers.get("svix-id") || "").trim();
  const svixTimestamp = String(headers.get("svix-timestamp") || "").trim();
  const svixSignature = String(headers.get("svix-signature") || "").trim();
  if (!svixId || !svixTimestamp || !svixSignature) {
    return false;
  }

  const ts = Number.parseInt(svixTimestamp, 10);
  if (!Number.isFinite(ts)) {
    return false;
  }
  if (Math.abs(Date.now() / 1000 - ts) > WEBHOOK_MAX_SKEW_SECONDS) {
    return false;
  }

  const cleanSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const keyBytes = base64Decode(cleanSecret);
  if (!keyBytes) {
    return false;
  }
  const keyBuffer = keyBytes.buffer.slice(
    keyBytes.byteOffset,
    keyBytes.byteOffset + keyBytes.byteLength,
  ) as ArrayBuffer;

  const payload = `${svixId}.${svixTimestamp}.${body}`;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(payload)),
  );
  const expected = bytesToBase64(signatureBytes);

  const received = svixSignature
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [ver, sig] = part.split(",");
      if (ver !== "v1") return "";
      return String(sig || "").trim();
    })
    .filter(Boolean);

  return received.some((sig) => constantTimeEqual(sig, expected));
}

function base64Decode(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let out = 0;
  for (let i = 0; i < a.length; i += 1) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
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
      const lat = Number(el.lat);
      const lon = Number(el.lon);
      const tags = (el.tags || {}) as Json;
      const existing = nodes.get(id);
      if (!existing) {
        nodes.set(id, { id, lat, lon, tags });
      } else {
        // Merge: keep valid coords and non-empty tags from either entry
        nodes.set(id, {
          id,
          lat: !isNaN(lat) ? lat : existing.lat,
          lon: !isNaN(lon) ? lon : existing.lon,
          tags: Object.keys(tags).length > 0 ? tags : existing.tags,
        });
      }
    } else if (type === "way") {
      const wayNodes = Array.isArray(el.nodes) ? (el.nodes as number[]) : [];
      // Handle embedded geometry from 'out body geom' format
      const wayGeometry = Array.isArray(el.geometry) ? (el.geometry as Json[]) : [];
      if (wayGeometry.length > 0) {
        wayNodes.forEach((nodeId, idx) => {
          if (idx < wayGeometry.length) {
            const geomNode = wayGeometry[idx];
            const lat = Number(geomNode.lat);
            const lon = Number(geomNode.lon);
            if (!nodes.has(nodeId) && !isNaN(lat) && !isNaN(lon)) {
              nodes.set(nodeId, { id: nodeId, lat, lon, tags: {} as Json });
            }
          }
        });
      }
      ways.push({
        id: Number(el.id),
        nodes: wayNodes,
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

function pickPrimaryRoadName(targetWays: Way[], fallback: string): string {
  const counts = new Map<string, number>();

  for (const way of targetWays) {
    const names = collectWayNames(way.tags);
    const preferred = names.find((name) => /[\u4e00-\u9fff]/.test(name)) || names[0] || "";
    const clean = preferred.trim();
    if (!clean) {
      continue;
    }
    counts.set(clean, (counts.get(clean) || 0) + 1);
  }

  let best = fallback.trim();
  let bestCount = -1;
  for (const [name, count] of counts) {
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  }

  return best || fallback;
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

  const latPad = Math.max((maxLat - minLat) * 0.08, 0.0015);
  const lonPad = Math.max((maxLon - minLon) * 0.08, 0.0015);

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

function getWayDepartureBearings(
  way: Way,
  intersectionNodeId: number,
  nodes: Map<number, { id: number; lat: number; lon: number; tags: Json }>,
): number[] {
  const bearings: number[] = [];

  for (let i = 0; i < way.nodes.length; i += 1) {
    if (way.nodes[i] !== intersectionNodeId) {
      continue;
    }

    const current = nodes.get(intersectionNodeId);
    const previous = i > 0 ? nodes.get(way.nodes[i - 1]) : null;
    const next = i < way.nodes.length - 1 ? nodes.get(way.nodes[i + 1]) : null;

    if (current && previous) {
      bearings.push(bearingDegrees(current, previous));
    }
    if (current && next) {
      bearings.push(bearingDegrees(current, next));
    }
  }

  return [...new Set(bearings.map((bearing) => Math.round(normalizeHeading(bearing))))];
}

function resolveTurnCandidates(
  candidates: Array<{ roadName: string; bearing: number }>,
  forwardBearing: number | null,
): { left: TurnCandidate | null; right: TurnCandidate | null } {
  if (forwardBearing === null) {
    return { left: null, right: null };
  }

  let left: TurnCandidate | null = null;
  let right: TurnCandidate | null = null;

  for (const candidate of candidates) {
    const delta = signedBearingDelta(forwardBearing, candidate.bearing);
    if (Math.abs(delta) < 25 || Math.abs(delta) > 155) {
      continue;
    }

    const turn: TurnCandidate = {
      roadName: candidate.roadName,
      bearing: Math.round(normalizeHeading(candidate.bearing)),
      direction: headingLabel(candidate.bearing),
      delta: Math.round(delta),
    };

    if (delta < 0) {
      if (!left || turnCandidateScore(turn) < turnCandidateScore(left)) {
        left = turn;
      }
      continue;
    }

    if (!right || turnCandidateScore(turn) < turnCandidateScore(right)) {
      right = turn;
    }
  }

  return { left, right };
}

function turnCandidateScore(candidate: TurnCandidate): number {
  return Math.abs(90 - Math.abs(candidate.delta));
}

function dedupeIntersections<T extends { id: number }>(
  rows: T[],
): T[] {
  const seen = new Set<number>();
  const out: T[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) {
      continue;
    }
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

  function calculateBearing(startLat: number, startLon: number, endLat: number, endLon: number): number {
    const dLon = ((endLon - startLon) * Math.PI) / 180;
    const lat1 = (startLat * Math.PI) / 180;
    const lat2 = (endLat * Math.PI) / 180;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    const bearing = (Math.atan2(y, x) * 180) / Math.PI;
    return ((bearing + 360) % 360);
  }
