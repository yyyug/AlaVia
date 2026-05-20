const DAY = 60 * 60 * 24;
const TTL_365_DAYS = 365 * DAY;
const CACHE_MAX_AGE_SECONDS = DAY;
const GEOCODE_TTL_SECONDS = 30 * DAY;
const OSM_CACHE_TTL_SECONDS = TTL_365_DAYS;
const OSM_CACHE_STALE_SECONDS = 30 * DAY;
const OVERPASS_TIMEOUT_MS = 30000;
const OVERPASS_PLACE_TIMEOUT_MS = 15000;
const OVERPASS_MAX_ITERATIONS = 2;
const OVERPASS_MIN_GROWTH_RATIO = 0.05;
const CLERK_DOMAIN = "possible-skink-4.clerk.accounts.dev";
const CLERK_ISSUER = `https://${CLERK_DOMAIN}`;
const EXTERNAL_API_TIMEOUT_MS = 10000;
const MAX_PAID_INTERSECTIONS = 50;
const MAX_REQUEST_BODY_BYTES = 100_000;
const WEBHOOK_MAX_SKEW_SECONDS = 300;
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_DEFAULT_PER_WINDOW = 120;
const RATE_LIMIT_PAID_PER_WINDOW = 30;
const BUILTIN_ADMIN_EMAILS = new Set(["yoofun@gmail.com"]);
const PRICES = {
    placesNearby: 0.005,
    streetViewStatic: 0.007,
    geminiGenerate: 0.0003,
};
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        if (url.pathname.startsWith("/api/") && url.pathname !== "/api/clerk/webhook") {
            try {
                await enforceGatewayPolicies(request, env, url.pathname);
            }
            catch (err) {
                return withErrorHandling(async () => {
                    throw err;
                });
            }
        }
        if (url.pathname === "/api/geocode/autobbox" && request.method === "POST") {
            return withErrorHandling(() => handleGeocodeAutoBbox(request));
        }
        if (url.pathname === "/api/geocode/reverse-road" && request.method === "POST") {
            return withErrorHandling(() => handleGeocodeReverseRoad(request, env, ctx));
        }
        if (url.pathname === "/api/overpass/segment" && request.method === "POST") {
            return withErrorHandling(() => handleOverpassSegment(request, env, ctx));
        }
        if (url.pathname === "/api/paid/places" && request.method === "POST") {
            return withErrorHandling(() => handlePaidPlaces(request, env, ctx));
        }
        if (url.pathname === "/api/paid/streetview" && request.method === "POST") {
            return withErrorHandling(() => handlePaidStreetView(request, env, ctx));
        }
        if (url.pathname === "/api/streetview/metadata" && request.method === "POST") {
            return withErrorHandling(() => handleStreetViewMetadata(request, env));
        }
        if (url.pathname === "/api/admin/cleanup-noimage" && request.method === "POST") {
            return withErrorHandling(() => handleCleanupNoImage(request, env));
        }
        if (url.pathname === "/api/admin/streetview-storage" && request.method === "POST") {
            return withErrorHandling(() => handleStreetViewStorageReport(request, env));
        }
        if (url.pathname === "/api/paid/route-scenery" && request.method === "POST") {
            return withErrorHandling(() => handlePaidRouteScenery(request, env, ctx));
        }
        if (url.pathname === "/api/osm/route-places" && request.method === "POST") {
            return withErrorHandling(() => handleOsmRoutePlaces(request, env, ctx));
        }
        if (url.pathname === "/api/google/route-places" && request.method === "POST") {
            return withErrorHandling(() => handleGoogleRoutePlaces(request, env, ctx));
        }
        if (url.pathname === "/api/intersections/address-batch" && request.method === "POST") {
            return withErrorHandling(() => handleIntersectionAddressBatch(request, env, ctx));
        }
        if (url.pathname === "/api/me" && request.method === "GET") {
            return withErrorHandling(() => handleMe(request, env));
        }
        if (url.pathname === "/api/billing/summary" && request.method === "GET") {
            return withErrorHandling(() => handleBillingSummary(request, env));
        }
        if (url.pathname === "/api/admin/users" && request.method === "GET") {
            return withErrorHandling(() => handleAdminListUsers(request, env));
        }
        if (url.pathname === "/api/admin/billing-summary" && request.method === "GET") {
            return withErrorHandling(() => handleAdminBillingSummary(request, env));
        }
        if (url.pathname === "/api/admin/approve-user" && request.method === "POST") {
            return withErrorHandling(() => handleAdminApproveUser(request, env));
        }
        if (url.pathname === "/api/admin/cache-stats" && request.method === "GET") {
            return withErrorHandling(() => handleAdminCacheStats(request, env));
        }
        if (url.pathname === "/api/admin/cache-purge-expired" && request.method === "POST") {
            return withErrorHandling(() => handleAdminCachePurgeExpired(request, env));
        }
        if (url.pathname === "/api/admin/cache-streets" && request.method === "GET") {
            return withErrorHandling(() => handleAdminCacheStreets(request, env));
        }
        if (url.pathname === "/api/clerk/webhook" && request.method === "POST") {
            return withErrorHandling(() => handleClerkWebhook(request, env));
        }
        return env.ASSETS.fetch(request);
    },
};
async function handleGeocodeAutoBbox(request) {
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
        const cached = (await edgeHit.json());
        return json(cached);
    }
    const normalizedCountry = /^[a-z]{2}$/.test(countryCode) ? countryCode : "";
    let items = [];
    let resolvedCountryCode = "";
    if (normalizedCountry === "hk") {
        const hkItems = await fetchNominatimSearch(query, "hk");
        if (hkItems.length > 0) {
            items = hkItems;
            resolvedCountryCode = "hk";
        }
        else {
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
    }
    else if (normalizedCountry) {
        const queryVariants = buildQueryVariants(query);
        for (const q of queryVariants) {
            const filteredItems = await fetchNominatimSearch(q, normalizedCountry);
            if (filteredItems.length > 0) {
                items = filteredItems;
                resolvedCountryCode = normalizedCountry;
                break;
            }
        }
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
    }
    else {
        items = await fetchNominatimSearch(query, "");
    }
    if (!Array.isArray(items) || items.length === 0) {
        throw new Error(`Geocode no result for query "${query}" (country: ${countryCode || "any"})`);
    }
    const first = items[0] || {};
    const bb = Array.isArray(first.boundingbox) ? first.boundingbox : [];
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
    }
    else {
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
    await getEdgeCache().put(edgeReq, new Response(JSON.stringify(payload), {
        headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": `public, max-age=${GEOCODE_TTL_SECONDS}`,
        },
    }));
    return json(payload);
}
async function handleGeocodeReverseRoad(request, env, ctx) {
    const body = await requireJson(request);
    const lat = Number(body.lat);
    const lon = Number(body.lon);
    validateCoordinates(lat, lon);
    const reverse = await fetchNominatimReverse(env, lat, lon, ctx);
    const roadName = extractRoadNameFromGeocodeRecord(reverse, "");
    if (!roadName) {
        throw new Error("Reverse geocode road not found");
    }
    const address = (reverse.address || {});
    return json({
        ok: true,
        lat: round6(lat),
        lon: round6(lon),
        roadName,
        displayName: String(reverse.display_name || roadName),
        country: String(address.country || "").trim(),
        countryCode: String(address.country_code || "").trim().toUpperCase() || null,
    });
}
function extractRoadNameFromGeocodeRecord(record, fallback) {
    const address = (record.address || {});
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
async function fetchWithTimeout(url, options = {}, timeoutMs = EXTERNAL_API_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort("fetch-timeout"), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    }
    finally {
        clearTimeout(timeoutId);
    }
}
function validateCoordinates(lat, lon) {
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
async function fetchNominatimSearch(query, countryCode = "") {
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
    const items = (await res.json());
    return Array.isArray(items) ? items : [];
}
async function handleOverpassSegment(request, env, ctx) {
    const body = await requireJson(request);
    const roadName = String(body.roadName || "").trim();
    const countryCode = String(body.countryCode || "").trim().toLowerCase();
    const focusLatRaw = body.focusLat !== undefined ? Number(body.focusLat) : null;
    const focusLonRaw = body.focusLon !== undefined ? Number(body.focusLon) : null;
    if (!roadName) {
        throw new Error("roadName is required");
    }
    const focusPoint = (focusLatRaw !== null && focusLonRaw !== null && Number.isFinite(focusLatRaw) && Number.isFinite(focusLonRaw))
        ? { lat: focusLatRaw, lon: focusLonRaw } : undefined;
    await ensureD1Schema(env);
    // Cache key uses only normalized road name — no bbox — so repeated queries for
    // the same road always hit the same cache entry regardless of Nominatim variance.
    const cachePayload = {
        roadName: normalizeRoadName(roadName),
        countryCode,
        version: 5,
    };
    const cached = await getOrCreateCached(env, "osm-segment-v2", cachePayload, async () => {
        // Nominatim + Overpass are only called on a true cache miss.
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
        const initialBbox = { south, west, north, east };
        let currentBbox = { ...initialBbox };
        let stabilizedReason = "max_iterations_reached";
        let iterationCount = 0;
        let previousMatchedIds = new Set();
        let overpassResult = null;
        let parsed = null;
        let targetWays = [];
        let allHighways = [];
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
            };
        }
        const nodeUsage = new Map();
        const nodeToWays = new Map();
        for (const w of allHighways) {
            for (const nid of w.nodes) {
                nodeUsage.set(nid, (nodeUsage.get(nid) || 0) + 1);
                const arr = nodeToWays.get(nid) || [];
                arr.push(w.id);
                nodeToWays.set(nid, arr);
            }
        }
        const wayById = new Map();
        for (const w of allHighways) {
            wayById.set(w.id, w);
        }
        const orderedNodeIds = flattenOrderedNodeIds(targetWays);
        const intersectionsRaw = [];
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
                .filter(Boolean);
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
            const intersectionName = baseName || `${primaryRoadName} × ${uniqueCross[0] || "未命名道路"}`;
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
        };
    }, OSM_CACHE_TTL_SECONDS, {
        ctx,
        staleWhileRevalidateSeconds: OSM_CACHE_STALE_SECONDS,
    });
    return json(cached.data);
}
async function fetchOverpassJson(query) {
    return fetchOverpassJsonWithEndpoints(query, [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
        "https://overpass.openstreetmap.fr/api/interpreter",
    ], OVERPASS_TIMEOUT_MS);
}
async function fetchOverpassPlaceJson(query) {
    return fetchOverpassJsonWithEndpoints(query, [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
        "https://overpass.openstreetmap.fr/api/interpreter",
    ], OVERPASS_PLACE_TIMEOUT_MS);
}
async function fetchOverpassJsonWithEndpoints(query, endpoints, timeoutMs) {
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
                    data: (await res.json()),
                    endpoint: base,
                };
            }
        }
        catch {
            lastStatus = 598;
        }
        finally {
            clearTimeout(timeoutId);
        }
    }
    throw new Error(`Overpass error: ${lastStatus}`);
}
async function fetchNominatimReverse(env, lat, lon, ctx) {
    const payload = { lat: round6(lat), lon: round6(lon) };
    const cached = await getOrCreateCached(env, "geocode-reverse-v2", payload, async () => {
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
        return (await res.json());
    }, TTL_365_DAYS, {
        ctx,
        staleWhileRevalidateSeconds: 30 * DAY,
    });
    return cached.data;
}
async function handleOsmRoutePlaces(request, env, ctx) {
    const body = await requireJson(request);
    const start = body.start;
    const end = body.end;
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
    const cached = await getOrCreateCached(env, "osm-route-places-v2", cachePayload, async () => {
        const bbox = expandBBoxAroundSegment(canonicalSegment.start, canonicalSegment.end, 38);
        const overpassResult = await fetchOverpassPlaceJson(buildOsmBBoxPlaceQuery(bbox));
        const segmentLength = haversineMeters(canonicalSegment.start, canonicalSegment.end);
        const maxOffset = Math.max(30, Math.min(60, segmentLength / 3));
        const candidates = dedupeOsmPlaces(parseOsmPlaceCandidates(overpassResult.data).map((place) => {
            const projection = projectPointToSegmentMeters(canonicalSegment.start, canonicalSegment.end, place);
            return {
                ...place,
                distanceMeters: Math.round(projection.alongMeters),
                sortMeters: Math.round(projection.alongMeters),
                distanceToLineMeters: Math.round(projection.distanceToLineMeters),
                onTargetRoad: roadName ? isTargetRoadPlace(place.streetName, roadName) : place.onTargetRoad,
            };
        })).filter((place) => place.distanceToLineMeters <= maxOffset);
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
        };
    }, OSM_CACHE_TTL_SECONDS, {
        ctx,
        staleWhileRevalidateSeconds: OSM_CACHE_STALE_SECONDS,
    });
    return json(adaptOsmRoutePlacesForDirection(cached.data, canonicalSegment));
}
function canonicalizeRouteSegment(start, end) {
    const a = { lat: round4(start.lat), lon: round4(start.lon) };
    const b = { lat: round4(end.lat), lon: round4(end.lon) };
    const keepOrder = a.lat < b.lat || (a.lat === b.lat && a.lon <= b.lon);
    return keepOrder
        ? { start: a, end: b, reversed: false }
        : { start: b, end: a, reversed: true };
}
function adaptOsmRoutePlacesForDirection(data, segment) {
    if (!segment.reversed) {
        return data;
    }
    const basePlaces = Array.isArray(data.places) ? data.places : [];
    const segmentMeters = Math.max(0, Math.round(haversineMeters(segment.start, segment.end)));
    const remapped = basePlaces
        .map((raw) => {
        const place = { ...raw };
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
            return `${Math.round(sortMeters)}m：${formatOsmPlaceLine(place, false)}`;
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
    };
}
async function handleGoogleRoutePlaces(request, env, ctx) {
    await requireClerkAuth(request, env);
    await ensureD1Schema(env);
    const body = await requireJson(request);
    requireUserConfirmedPaidCall(body);
    const start = body.start;
    const end = body.end;
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
    const cached = await getOrCreateCached(env, "google-route-places-v1", cachePayload, async () => {
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
        };
    }, TTL_365_DAYS, {
        ctx,
        staleWhileRevalidateSeconds: 30 * DAY,
    });
    return json(cached.data);
}
async function handleIntersectionAddressBatch(request, env, ctx) {
    const body = await requireJson(request);
    const roadName = String(body.roadName || "").trim();
    const pointsRaw = Array.isArray(body.points) ? body.points : [];
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
    const rows = await Promise.all(points.map(async (point) => {
        try {
            const reverse = await fetchNominatimReverse(env, point.lat, point.lon, ctx);
            const address = buildIntersectionAddressLabel(reverse, roadName);
            return {
                idx: point.idx,
                id: point.id,
                addressLabel: address.label,
                addressSource: address.source,
            };
        }
        catch {
            return {
                idx: point.idx,
                id: point.id,
                addressLabel: null,
                addressSource: null,
            };
        }
    }));
    return json({
        ok: true,
        count: rows.length,
        rows,
    });
}
async function enrichIntersectionsWithAddresses(env, ctx, intersections, roadName) {
    return Promise.all(intersections.map(async (row, index) => {
        try {
            const sample = chooseIntersectionAddressSample(intersections, index);
            const reverse = await fetchNominatimReverse(env, sample.lat, sample.lon, ctx);
            const address = buildIntersectionAddressLabel(reverse, roadName);
            return {
                ...row,
                addressLabel: address.label,
                addressSource: address.source,
            };
        }
        catch {
            return {
                ...row,
                addressLabel: null,
                addressSource: null,
            };
        }
    }));
}
function chooseIntersectionAddressSample(intersections, index) {
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
function buildIntersectionAddressLabel(reverse, roadName) {
    const address = (reverse.address || {});
    const streetName = String(address.road || address.pedestrian || address.residential || address.footway || address.cycleway || address.path || "").trim();
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
function buildOsmAroundPlaceQuery(lat, lon, radius) {
    return `
[out:json][timeout:25];
(
${buildOsmPlaceStatements(`(around:${Math.round(radius)},${lat},${lon})`)}
);
out center tags;
`;
}
function buildOsmBBoxPlaceQuery(bbox) {
    return `
[out:json][timeout:25];
(
${buildOsmPlaceStatements(`(${bbox.south},${bbox.west},${bbox.north},${bbox.east})`)}
);
out center tags;
`;
}
function buildOsmPlaceStatements(selector) {
    const lines = [];
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
function parseOsmPlaceCandidates(overpass) {
    const elements = Array.isArray(overpass.elements) ? overpass.elements : [];
    const rows = [];
    for (const element of elements) {
        const row = buildOsmPlaceCandidate(element);
        if (row) {
            rows.push(row);
        }
    }
    return rows;
}
function buildOsmPlaceCandidate(element) {
    const type = String(element.type || "").trim();
    const center = (element.center || {});
    const tags = (element.tags || {});
    const lat = type === "node" ? Number(element.lat) : Number(center.lat);
    const lon = type === "node" ? Number(element.lon) : Number(center.lon);
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
    const explicitName = String(tags["name:zh"] || tags.name || tags.brand || tags.operator || tags.ref || "").trim();
    const kindLabel = describeOsmKind(tags);
    const hasSpecificFeature = Boolean(tags.amenity || tags.shop || tags.tourism || tags.office ||
        tags.railway || tags.public_transport || tags.entrance ||
        highwayVal === "bus_stop" || highwayVal === "crossing" ||
        tags.leisure || tags.landuse);
    const title = explicitName || addressLabel || (hasSpecificFeature ? kindLabel : null);
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
function shouldIncludeIntersectionCrossWay(way) {
    const highway = String(way.tags.highway || "").trim().toLowerCase();
    if (!highway) {
        return false;
    }
    return highway !== "footway" && highway !== "path" && highway !== "steps";
}
function dedupeOsmPlaces(places) {
    const seen = new Set();
    const out = [];
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
function prioritizeRoutePlaces(candidates) {
    const sorted = [...candidates].sort((a, b) => a.sortMeters - b.sortMeters || a.distanceToLineMeters - b.distanceToLineMeters);
    const filtered = [];
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
        const nearbyOnRoad = filtered.some((kept) => kept.onTargetRoad && Math.abs(kept.sortMeters - place.sortMeters) <= 35);
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
function routePlaceBand(place) {
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
function assessOsmCoverage(selected, allCandidates) {
    const onRoadAddressCount = selected.filter((place) => place.onTargetRoad && place.hasHouseNumber).length;
    const onRoadNamedCount = selected.filter((place) => place.onTargetRoad && place.hasExplicitName).length;
    const unnamedCommercialCount = allCandidates.filter((place) => place.onTargetRoad && place.hasFeatureTag && !place.hasExplicitName).length;
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
function shouldUseGooglePlacesFallback(assessment) {
    return assessment.shouldFallback;
}
async function fetchGooglePlacesAlongSegment(env, start, end, roadName, language) {
    const apiKey = requireGoogleMapsKey(env);
    const samplePoints = buildGoogleFallbackSamplePoints(start, end);
    const results = [];
    for (let i = 0; i < samplePoints.length; i += 1) {
        const point = samplePoints[i];
        const places = await fetchGooglePlaces(apiKey, round6(point.lat), round6(point.lon), 35, language);
        const list = Array.isArray(places.places) ? places.places : [];
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
function buildGoogleFallbackSamplePoints(start, end) {
    const total = haversineMeters(start, end);
    const segments = total < 80 ? [0.5] : total < 180 ? [0.25, 0.75] : [0.15, 0.5, 0.85];
    return segments.map((t) => ({
        lat: start.lat + (end.lat - start.lat) * t,
        lon: start.lon + (end.lon - start.lon) * t,
    }));
}
function buildGoogleRoutePlaceCandidate(item, start, end, roadName) {
    const location = (item.location || {});
    const lat = Number(location.latitude);
    const lon = Number(location.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return null;
    }
    const displayName = (item.displayName || {});
    const title = String(displayName.text || "").trim();
    if (!title) {
        return null;
    }
    const types = Array.isArray(item.types) ? item.types : [];
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
function extractGoogleStreetName(vicinity) {
    if (!vicinity) {
        return null;
    }
    const first = vicinity.split(",")[0]?.trim() || "";
    return first || null;
}
function dedupeGoogleRoutePlaces(places) {
    const seen = new Set();
    const out = [];
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
function formatGoogleRoutePlaceLine(place) {
    const parts = [place.title];
    if (place.addressLabel) {
        parts.push(place.addressLabel);
    }
    if (place.typeLabel) {
        parts.push(place.typeLabel);
    }
    return parts.join("，");
}
function formatOsmPlaceLine(place, includeDistance) {
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
function formatStreetAddress(streetName, houseNumber, houseName) {
    const parts = [streetName || "", houseNumber].filter(Boolean);
    const base = parts.join(" ").trim();
    if (houseName && houseName !== base) {
        return base ? `${base}，${houseName}` : houseName;
    }
    return base || null;
}
function describeOsmKind(tags) {
    // Transit: highway values
    const highwayVal = String(tags.highway || "").trim();
    if (highwayVal === "bus_stop")
        return "巴士站";
    if (highwayVal === "crossing")
        return "行人過路";
    // Transit: railway values
    const railwayVal = String(tags.railway || "").trim();
    if (railwayVal === "tram_stop")
        return "電車站";
    if (railwayVal === "subway_entrance")
        return "港鐵出入口";
    if (railwayVal === "station")
        return "鐵路站";
    if (railwayVal === "halt")
        return "車站";
    // Transit: public_transport
    const ptVal = String(tags.public_transport || "").trim();
    if (ptVal === "platform")
        return "月台";
    if (ptVal === "stop_position")
        return "站";
    // Entrance
    const entranceVal = String(tags.entrance || "").trim();
    if (entranceVal && entranceVal !== "no")
        return "入口";
    // Leisure landmarks
    const leisureVal = String(tags.leisure || "").trim();
    const leisureLabels = {
        park: "公園",
        playground: "遊樂場",
        sports_centre: "體育中心",
        stadium: "體育場",
        swimming_pool: "游泳池",
        garden: "花園",
    };
    if (leisureVal)
        return leisureLabels[leisureVal] ?? leisureVal.replaceAll("_", " ");
    // Landuse areas
    const landuseVal = String(tags.landuse || "").trim();
    const landuseLabels = {
        retail: "商業區",
        commercial: "商業區",
        industrial: "工業區",
        cemetery: "墳場",
        recreation_ground: "休憩用地",
    };
    if (landuseVal)
        return landuseLabels[landuseVal] ?? null;
    // Amenity / shop / tourism / office / building
    const raw = String(tags.amenity || tags.shop || tags.tourism || tags.office || tags.building || "").trim();
    if (!raw || raw === "yes") {
        return null;
    }
    const labels = {
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
function isTargetRoadPlace(streetName, roadName) {
    if (!streetName || !roadName) {
        return false;
    }
    return isRoadNameMatch(normalizeRoadName(streetName), normalizeRoadName(roadName), tokenizeRoadQuery(roadName));
}
function expandBBoxAroundSegment(start, end, padMeters) {
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
function projectPointToSegmentMeters(start, end, point) {
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
function toLocalMeters(origin, point) {
    const avgLatRad = ((origin.lat + point.lat) / 2) * (Math.PI / 180);
    return {
        x: (point.lon - origin.lon) * 111_320 * Math.cos(avgLatRad),
        y: (point.lat - origin.lat) * 110_540,
    };
}
function metersToLatDegrees(meters) {
    return meters / 110_540;
}
function metersToLonDegrees(meters, lat) {
    const cosLat = Math.max(0.1, Math.cos((lat * Math.PI) / 180));
    return meters / (111_320 * cosLat);
}
function sanitizeErrorMessage(message) {
    if (/api[_-]?key/i.test(message))
        return "Configuration error";
    if (/\bD1\b|sqlite|database/i.test(message))
        return "Database error";
    if (message.includes("sk_") || message.includes("pk_"))
        return "Configuration error";
    return message;
}
async function withErrorHandling(fn) {
    try {
        return await fn();
    }
    catch (err) {
        const raw = err instanceof Error ? err.message : "Unexpected error";
        console.error({ timestamp: new Date().toISOString(), error: raw });
        const status = raw === "Authentication required" || raw === "Invalid or expired session"
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
async function enforceGatewayPolicies(request, env, path) {
    enforceAllowedAccessEmails(request, env);
    const pathGroup = path.startsWith("/api/paid/") || path.startsWith("/api/google/") ? "paid" : "default";
    const perWindow = pathGroup === "paid" ? RATE_LIMIT_PAID_PER_WINDOW : RATE_LIMIT_DEFAULT_PER_WINDOW;
    await enforceRateLimit(request, env, `ip:${pathGroup}`, perWindow, RATE_LIMIT_WINDOW_SECONDS);
}
function enforceAllowedAccessEmails(request, env) {
    const host = new URL(request.url).hostname.toLowerCase();
    if (host === "127.0.0.1" || host === "localhost") {
        return;
    }
    const allowed = String(env.ALLOWED_ACCESS_EMAILS || "")
        .split(",")
        .map((v) => v.trim().toLowerCase())
        .filter(Boolean);
    if (allowed.length === 0) {
        return;
    }
    const email = String(request.headers.get("cf-access-authenticated-user-email") || "")
        .trim()
        .toLowerCase();
    if (!email) {
        throw new Error("Cloudflare Access authentication required");
    }
    if (!allowed.includes(email)) {
        throw new Error("Access denied for this email");
    }
}
async function enforceRateLimit(request, env, scope, limit, windowSeconds) {
    const ip = getClientIp(request);
    if (!ip) {
        return;
    }
    await ensureD1Schema(env);
    const now = nowEpoch();
    const bucket = Math.floor(now / windowSeconds);
    const expiresAt = (bucket + 1) * windowSeconds + windowSeconds;
    const key = `${scope}:${ip}:${bucket}`;
    const row = await env.DB.prepare(`INSERT INTO rate_limits (rate_key, count, expires_at, updated_at)
     VALUES (?1, 1, ?2, ?3)
     ON CONFLICT(rate_key) DO UPDATE SET
       count = count + 1,
       updated_at = excluded.updated_at
     RETURNING count`)
        .bind(key, expiresAt, now)
        .first();
    const count = Number(row?.count || 0);
    if (count > limit) {
        throw new Error("Too many requests");
    }
    if (Math.random() < 0.02) {
        await env.DB.prepare("DELETE FROM rate_limits WHERE expires_at < ?1").bind(now).run();
    }
}
function getClientIp(request) {
    const direct = String(request.headers.get("cf-connecting-ip") || "").trim();
    if (direct) {
        return direct;
    }
    const forwarded = String(request.headers.get("x-forwarded-for") || "").trim();
    if (!forwarded) {
        return "";
    }
    return forwarded.split(",")[0]?.trim() || "";
}
function getEdgeCache() {
    return caches.default;
}
function json(data, status = 200) {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
        },
    });
}
async function requireJson(request) {
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
        throw new Error("Request must use application/json");
    }
    return (await request.json());
}
function requireUserConfirmedPaidCall(body) {
    if (body.userConfirmedPaidCall !== true) {
        throw new Error("Paid API calls require explicit user action");
    }
}
function requireGoogleMapsKey(env) {
    if (!env.GOOGLE_MAPS_API_KEY) {
        throw new Error("GOOGLE_MAPS_API_KEY is not configured");
    }
    return env.GOOGLE_MAPS_API_KEY;
}
function requireGeminiKey(env) {
    const key = env.GEMINI_API_KEY;
    if (!key) {
        throw new Error("GEMINI_API_KEY is not configured");
    }
    return key;
}
// ── Clerk authentication ──────────────────────────────────────────────────
function base64UrlDecode(input) {
    const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, "=");
    const binary = atob(padded);
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
async function fetchClerkJWKS() {
    const edgeReq = new Request(`https://cache.local/clerk-jwks/${CLERK_DOMAIN}`);
    const cached = await getEdgeCache().match(edgeReq);
    if (cached) {
        const data = (await cached.json());
        return data.keys;
    }
    const res = await fetchWithTimeout(`https://${CLERK_DOMAIN}/.well-known/jwks.json`, {}, 5000);
    if (!res.ok)
        throw new Error("Failed to fetch authentication keys");
    const data = (await res.json());
    await getEdgeCache().put(edgeReq, new Response(JSON.stringify(data), {
        headers: { "cache-control": "public, max-age=3600", "content-type": "application/json" },
    }));
    return data.keys;
}
async function verifyClerkToken(token) {
    try {
        const parts = token.split(".");
        if (parts.length !== 3)
            return null;
        const [headerB64, payloadB64, signatureB64] = parts;
        const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(headerB64)));
        if (header.alg !== "RS256")
            return null;
        const keys = await fetchClerkJWKS();
        const jwk = keys.find((k) => k.kid === header.kid);
        if (!jwk)
            return null;
        const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
        const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
        const signatureBytes = base64UrlDecode(signatureB64);
        const signature = new Uint8Array(signatureBytes.length);
        signature.set(signatureBytes);
        const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, signingInput);
        if (!valid)
            return null;
        const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64)));
        const now = Math.floor(Date.now() / 1000);
        if (!payload.sub || !Number.isFinite(payload.exp))
            return null;
        if (payload.exp < Math.floor(Date.now() / 1000))
            return null;
        if (Number.isFinite(payload.nbf) && Number(payload.nbf) > now + 30)
            return null;
        if (Number.isFinite(payload.iat) && Number(payload.iat) > now + 30)
            return null;
        return { userId: payload.sub, payload };
    }
    catch {
        return null;
    }
}
function issuerMatches(iss) {
    const normalized = String(iss || "").trim().replace(/\/+$/, "");
    return normalized === CLERK_ISSUER.replace(/\/+$/, "");
}
function audienceMatches(aud, expected) {
    if (!aud)
        return false;
    const target = expected.trim();
    if (!target)
        return true;
    if (Array.isArray(aud)) {
        return aud.some((item) => String(item).trim() === target);
    }
    return String(aud).trim() === target;
}
async function getClerkUserMeta(userId, secretKey) {
    const edgeReq = new Request(`https://cache.local/clerk-user-meta/${userId}`);
    const cached = await getEdgeCache().match(edgeReq);
    if (cached) {
        return (await cached.json());
    }
    const res = await fetchWithTimeout(`https://api.clerk.com/v1/users/${encodeURIComponent(userId)}`, { headers: { Authorization: `Bearer ${secretKey}` } }, 5000);
    if (!res.ok)
        return { approved: false, email: "", isAdmin: false };
    const user = (await res.json());
    const approved = user.public_metadata?.approved === true;
    const email = user.email_addresses?.[0]?.email_address || "";
    const isAdmin = user.public_metadata?.role === "admin" || BUILTIN_ADMIN_EMAILS.has(email.toLowerCase());
    const result = { approved, email, isAdmin };
    await getEdgeCache().put(edgeReq, new Response(JSON.stringify(result), {
        headers: { "cache-control": "public, max-age=60", "content-type": "application/json" },
    }));
    return result;
}
async function requireClerkAuth(request, env) {
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
    await enforceRateLimit(request, env, `user-auth:${verified.userId}`, RATE_LIMIT_DEFAULT_PER_WINDOW, RATE_LIMIT_WINDOW_SECONDS);
    const meta = await getClerkUserMeta(verified.userId, secretKey);
    if (!meta.approved) {
        throw new Error("Your account is pending approval");
    }
    return { userId: verified.userId, email: meta.email, isAdmin: meta.isAdmin };
}
async function requireAdminAuth(request, env) {
    const user = await requireClerkAuth(request, env);
    if (!user.isAdmin) {
        throw new Error("Admin access required");
    }
    return user;
}
async function handlePaidPlaces(request, env, _ctx) {
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
    const lines = [];
    let billableCalls = 0;
    let cacheHits = 0;
    for (const item of intersections) {
        const row = item;
        const lat = Number(row.lat);
        const lon = Number(row.lon);
        validateCoordinates(lat, lon);
        const name = String(row.name || `${lat},${lon}`);
        const payload = { lat: round6(lat), lon: round6(lon), radius, language };
        const cached = await getOrCreateCached(env, "places", payload, async () => {
            const places = await fetchGooglePlaces(apiKey, payload.lat, payload.lon, payload.radius, payload.language);
            return places;
        }, TTL_365_DAYS);
        if (cached.cacheHit) {
            cacheHits += 1;
        }
        else {
            billableCalls += 1;
        }
        const list = Array.isArray(cached.data.places) ? cached.data.places : [];
        const top = list.slice(0, 5).map((p) => {
            const displayName = (p.displayName || {});
            const title = String(displayName.text || "未命名地標");
            const types = Array.isArray(p.types) ? p.types.slice(0, 2).join("/") : "";
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
async function handlePaidStreetView(request, env, ctx) {
    const clerkUser = await requireClerkAuth(request, env);
    await ensureD1Schema(env);
    const body = await requireJson(request);
    requireUserConfirmedPaidCall(body);
    const lat = Number(body.lat);
    const lon = Number(body.lon);
    const heading = Number(body.heading ?? 0);
    const fov = Number(body.fov ?? 90);
    const pitch = Number(body.pitch ?? 0);
    const language = normalizeMapsLanguage(String(body.language || "zh-TW"));
    validateCoordinates(lat, lon);
    const mapsKey = requireGoogleMapsKey(env);
    const geminiKey = requireGeminiKey(env);
    const views = [
        { label: "左側", heading: normalizeHeading(heading + 90) },
        { label: "右側", heading: normalizeHeading(heading + 270) },
    ];
    let billableImages = 0;
    let billableGemini = 0;
    let imageCacheHits = 0;
    let geminiCacheHits = 0;
    const blocks = [];
    for (const view of views) {
        const payload = {
            lat: round6(lat),
            lon: round6(lon),
            heading: view.heading,
            fov,
            pitch,
        };
        const metaStatus = await fetchStreetViewMetadata(mapsKey, payload.lat, payload.lon);
        if (metaStatus === "ZERO_RESULTS" || metaStatus === "NOT_FOUND") {
            const visionText = `此地點無 Street View 覆蓋（${metaStatus}）`;
            blocks.push(`${view.label}：${visionText}`);
            continue;
        }
        const imageCached = await getOrCreateCached(env, "streetview-image-v1", payload, async () => {
            const imageUrl = buildStreetViewUrl(mapsKey, { ...payload, language: "en" });
            const imageBytes = await fetchImageBytes(imageUrl);
            const imageObjectKey = await storeStreetViewImage(env, payload, imageBytes);
            return { imageUrl, imageObjectKey };
        }, TTL_365_DAYS, {
            ctx,
            staleWhileRevalidateSeconds: 30 * DAY,
        });
        if (imageCached.cacheHit) {
            imageCacheHits += 1;
        }
        else {
            billableImages += 1;
        }
        const textPayload = {
            ...payload,
            language,
        };
        const textCached = await getOrCreateCached(env, "streetview-gemini-text-v1", textPayload, async () => {
            const imageObjectKey = String(imageCached.data.imageObjectKey || "").trim();
            if (!imageObjectKey) {
                throw new Error("Street View image cache key is missing");
            }
            const imageObj = await env.CACHE_BUCKET.get(imageObjectKey);
            if (!imageObj) {
                throw new Error("Street View image cache not found");
            }
            const imageBytes = new Uint8Array(await imageObj.arrayBuffer());
            const imageBase64 = bytesToBase64(imageBytes);
            const description = await fetchGeminiDescription(geminiKey, imageBase64, language);
            return { description };
        }, TTL_365_DAYS, {
            ctx,
            staleWhileRevalidateSeconds: 30 * DAY,
        });
        if (textCached.cacheHit) {
            geminiCacheHits += 1;
        }
        else {
            billableGemini += 1;
        }
        const visionText = String(textCached.data.description || "未取得完整描述");
        blocks.push(`${view.label}：${visionText}`);
    }
    const estimatedCalls = views.length * 2;
    const estimatedUsd = views.length * (PRICES.streetViewStatic + PRICES.geminiGenerate);
    const actualUsd = billableImages * PRICES.streetViewStatic + billableGemini * PRICES.geminiGenerate;
    await recordBilling(env, {
        provider: "streetview",
        cacheHit: billableImages + billableGemini === 0 ? 1 : 0,
        estimatedUsd,
        actualUsd,
        userId: clerkUser.userId,
    });
    const text = [
        "街景詳細描述完成。",
        `預估請求 ${estimatedCalls} 次，預估費用 $${estimatedUsd.toFixed(3)}。`,
        `Street View：新請求 ${billableImages} 次，圖片快取命中 ${imageCacheHits} 次。`,
        `Gemini：新請求 ${billableGemini} 次，描述快取命中 ${geminiCacheHits} 次。`,
        `實際費用 $${actualUsd.toFixed(3)}。`,
        "",
        ...blocks,
    ].join("\n");
    return json({
        ok: true,
        provider: "streetview",
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
async function handleStreetViewMetadata(request, env) {
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
async function handleCleanupNoImage(request, env) {
    await requireAdminAuth(request, env);
    await ensureD1Schema(env);
    const body = await requireJson(request);
    const provider = String(body.provider || "streetview-image-v1").trim();
    if (!provider) {
        throw new Error("provider is required");
    }
    const list = await env.DB.prepare("SELECT cache_key, object_key FROM api_cache WHERE provider = ?1").bind(provider).all();
    const rows = Array.isArray(list.results) ? list.results : [];
    let deletedCount = 0;
    let scannedCount = 0;
    for (const row of rows) {
        scannedCount += 1;
        const obj = await env.CACHE_BUCKET.get(row.object_key);
        if (!obj) {
            continue;
        }
        let payload = null;
        try {
            payload = (await obj.json());
        }
        catch {
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
async function handleStreetViewStorageReport(request, env) {
    await requireAdminAuth(request, env);
    await ensureD1Schema(env);
    await requireJson(request);
    const provider = "streetview-image-v1";
    const list = await env.DB.prepare("SELECT cache_key, object_key FROM api_cache WHERE provider = ?1").bind(provider).all();
    const rows = Array.isArray(list.results) ? list.results : [];
    let cacheEntryCount = 0;
    let missingCacheObjectCount = 0;
    let missingImageObjectCount = 0;
    let noImageEntryCount = 0;
    let totalBytes = 0;
    const seenImageObjectKeys = new Set();
    const items = [];
    for (const row of rows) {
        cacheEntryCount += 1;
        const cacheObj = await env.CACHE_BUCKET.get(row.object_key);
        if (!cacheObj) {
            missingCacheObjectCount += 1;
            continue;
        }
        const payload = (await cacheObj.json());
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
async function handleAdminCacheStats(request, env) {
    await requireAdminAuth(request, env);
    await ensureD1Schema(env);
    const now = nowEpoch();
    const rows = await env.DB.prepare("SELECT provider, cache_key, object_key, expires_at, cache_meta FROM api_cache").all();
    const items = Array.isArray(rows.results) ? rows.results : [];
    const byProvider = new Map();
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
        const size = Number(obj.size || 0);
        if (Number.isFinite(size) && size > 0) {
            stat.totalBytes += size;
        }
        else {
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
async function handleAdminCachePurgeExpired(request, env) {
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
        ? await env.DB.prepare(sql).bind(provider, now, maxDelete).all()
        : await env.DB.prepare(sql).bind(now, maxDelete).all();
    const items = Array.isArray(rows.results) ? rows.results : [];
    let deletedCount = 0;
    let deletedBytes = 0;
    for (const row of items) {
        const obj = await env.CACHE_BUCKET.get(row.object_key);
        if (obj) {
            const size = Number(obj.size || 0);
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
async function handleAdminCacheStreets(request, env) {
    await requireAdminAuth(request, env);
    await ensureD1Schema(env);
    const now = nowEpoch();
    const rows = await env.DB.prepare("SELECT provider, cache_key, object_key, expires_at, cache_meta FROM api_cache WHERE provider = ?1 ORDER BY expires_at ASC LIMIT 2000").bind("osm-segment-v2").all();
    const items = Array.isArray(rows.results) ? rows.results : [];
    const grouped = new Map();
    for (const row of items) {
        const meta = parseCacheMeta(row.cache_meta);
        const obj = await env.CACHE_BUCKET.get(row.object_key);
        const payload = obj ? (await obj.json()) : {};
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
    const entries = [...grouped.values()];
    entries.sort((a, b) => a.expiresInSeconds - b.expiresInSeconds);
    return json({
        ok: true,
        generatedAt: now,
        rawCount: items.length,
        count: entries.length,
        entries,
    });
}
function resolveCacheCountry(meta, payload, roadName) {
    const direct = String(meta.countryCode || payload.countryCode || "").trim().toUpperCase();
    if (direct) {
        return direct;
    }
    const diagnostics = (payload.diagnostics || {});
    const bbox = (diagnostics.initialBBox || diagnostics.finalBBox || {});
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
    if (normalized.includes("香港") ||
        normalized.includes("九龍") ||
        normalized.includes("hongkong") ||
        normalized.includes("kowloon") ||
        normalized.includes("nathanroad") ||
        normalized.includes("彌敦道")) {
        return "HK";
    }
    return "未設定";
}
function parseCacheMeta(raw) {
    if (!raw) {
        return {};
    }
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
    }
    catch {
        return {};
    }
}
function tokenizeRoadQuery(name) {
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
function collectWayNames(tags) {
    const keys = ["name", "name:zh", "name:ja", "name:en", "official_name", "alt_name", "short_name"];
    const out = [];
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
function isRoadNameMatch(nameNorm, queryNorm, queryTokens) {
    if (!nameNorm || !queryNorm) {
        return false;
    }
    if (nameNorm.includes(queryNorm) || queryNorm.includes(nameNorm)) {
        return true;
    }
    return queryTokens.some((token) => token.length >= 2 && (nameNorm.includes(token) || token.includes(nameNorm)));
}
async function handlePaidRouteScenery(request, env, _ctx) {
    const clerkUser = await requireClerkAuth(request, env);
    await ensureD1Schema(env);
    const body = await requireJson(request);
    requireUserConfirmedPaidCall(body);
    const start = body.start;
    const end = body.end;
    const intervalMeters = Number(body.intervalMeters ?? 50);
    const heading = Number(body.heading ?? 0);
    const language = normalizeMapsLanguage(String(body.language || "zh-TW"));
    const mapsKey = requireGoogleMapsKey(env);
    const geminiKey = requireGeminiKey(env);
    const points = sampleLineByMeters({ lat: Number(start.lat), lon: Number(start.lon) }, { lat: Number(end.lat), lon: Number(end.lon) }, intervalMeters);
    let billableImages = 0;
    let billableGemini = 0;
    let cacheHits = 0;
    const lines = [];
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
        const cached = await getOrCreateCached(env, "route-scenery-gemini-v1", payload, async () => {
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
        }, TTL_365_DAYS);
        if (cached.cacheHit) {
            cacheHits += 1;
        }
        else if (!cached.data.noImage) {
            billableImages += 1;
            billableGemini += 1;
        }
        const text = cached.data.noImage
            ? `此地點無 Street View 覆蓋（${cached.data.metadataStatus}）`
            : String(cached.data.description || "未取得完整描述");
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
        `實際計費影像 ${billableImages} 次，Gemini ${billableGemini} 次，cache 命中 ${cacheHits} 次。`,
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
function buildStreetViewUrl(apiKey, args) {
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
async function fetchStreetViewMetadata(apiKey, lat, lon) {
    try {
        const p = new URLSearchParams({ location: `${lat},${lon}`, key: apiKey });
        const url = `https://maps.googleapis.com/maps/api/streetview/metadata?${p.toString()}`;
        const res = await fetchWithTimeout(url, {}, 8000);
        if (!res.ok)
            return "API_ERROR";
        const body = (await res.json());
        return String(body.status || "UNKNOWN");
    }
    catch {
        return "API_ERROR";
    }
}
async function fetchImageBytes(imageUrl) {
    const res = await fetchWithTimeout(imageUrl, {}, 15000);
    if (!res.ok) {
        throw new Error(`Street View image fetch failed: HTTP ${res.status}`);
    }
    return new Uint8Array(await res.arrayBuffer());
}
async function storeStreetViewImage(env, payload, bytes) {
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
function bytesToBase64(bytes) {
    const chunkSize = 0x8000;
    let binary = "";
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}
async function fetchGooglePlaces(apiKey, lat, lon, radius, language) {
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
    const res = await fetchWithTimeout(url, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": fieldMask,
        },
        body: JSON.stringify(reqBody),
    }, 10000);
    if (!res.ok) {
        throw new Error(`Google Places error: ${res.status}`);
    }
    const jsonBody = (await res.json());
    const places = Array.isArray(jsonBody.places) ? jsonBody.places : [];
    if (!Array.isArray(places)) {
        throw new Error("Google Places response malformed");
    }
    return { places };
}
function normalizeMapsLanguage(value) {
    const v = value.trim().toLowerCase();
    if (v.startsWith("en"))
        return "en";
    if (v.startsWith("ja"))
        return "ja";
    if (v.startsWith("ko"))
        return "ko";
    return "zh-TW";
}
async function fetchGeminiDescription(apiKey, imageBase64, language) {
    const prompt = [
        `Please answer in ${language} and provide 1 to 3 complete sentences.`,
        "Focus on: shops, shop names, building, and traffic lights/pedestrian facilities (omit this part if none are visible).",
        "If uncertain, clearly say it may be the case or cannot be fully confirmed.",
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
            maxOutputTokens: 240,
        },
    };
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetchWithTimeout(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(reqBody),
    }, 30000);
    const body = (await res.json().catch(() => ({})));
    if (!res.ok) {
        const errMsg = extractGoogleErrorMessage(body) || `HTTP ${res.status}`;
        throw new Error(`Gemini 失敗：${errMsg}`);
    }
    const candidates = Array.isArray(body.candidates) ? body.candidates : [];
    const first = candidates[0] || {};
    const content = (first.content || {});
    const parts = Array.isArray(content.parts) ? content.parts : [];
    const text = parts.map((p) => String(p.text || "").trim()).filter(Boolean).join("\n").trim();
    if (!text) {
        throw new Error("Gemini 回傳內容為空");
    }
    return text;
}
function extractGoogleErrorMessage(payload) {
    const err = (payload.error || {});
    const direct = String(err.message || "").trim();
    if (direct) {
        return direct;
    }
    const details = Array.isArray(err.details) ? err.details : [];
    for (const item of details) {
        const inner = String(item.message || "").trim();
        if (inner) {
            return inner;
        }
    }
    return "";
}
async function getOrCreateCached(env, provider, payload, creator, ttlSeconds, options) {
    const cacheKey = await buildCacheKey(provider, payload);
    const edgeReq = new Request(`https://cache.local/${provider}/${cacheKey}`);
    const edgeHit = await getEdgeCache().match(edgeReq);
    if (edgeHit) {
        const data = (await edgeHit.json());
        return { data, cacheHit: true };
    }
    const now = nowEpoch();
    const staleWhileRevalidateSeconds = Math.max(0, Number(options?.staleWhileRevalidateSeconds || 0));
    const row = await env.DB.prepare("SELECT object_key, expires_at FROM api_cache WHERE cache_key = ?1 AND provider = ?2 LIMIT 1")
        .bind(cacheKey, provider)
        .first();
    if (row) {
        const obj = await env.CACHE_BUCKET.get(row.object_key);
        if (obj) {
            const data = (await obj.json());
            await env.DB.prepare("UPDATE api_cache SET last_access_at = ?1 WHERE cache_key = ?2").bind(now, cacheKey).run();
            await writeEdgeCache(edgeReq, data);
            if (row.expires_at > now) {
                return { data, cacheHit: true };
            }
            const staleFor = now - row.expires_at;
            if (staleFor <= staleWhileRevalidateSeconds) {
                if (options?.ctx) {
                    options.ctx.waitUntil((async () => {
                        const fresh = await creator();
                        await persistCachedValue(env, provider, cacheKey, payload, fresh, nowEpoch() + ttlSeconds, nowEpoch());
                        await writeEdgeCache(edgeReq, fresh);
                    })());
                }
                return { data, cacheHit: true, stale: true };
            }
        }
    }
    const data = await creator();
    await persistCachedValue(env, provider, cacheKey, payload, data, now + ttlSeconds, now);
    await writeEdgeCache(edgeReq, data);
    return { data, cacheHit: false };
}
async function persistCachedValue(env, provider, cacheKey, payload, data, expiresAt, now) {
    const objectKey = `${provider}/${cacheKey}.json`;
    const cacheMeta = stableStringify(payload);
    await env.CACHE_BUCKET.put(objectKey, JSON.stringify(data), {
        httpMetadata: {
            contentType: "application/json; charset=utf-8",
            cacheControl: `max-age=${CACHE_MAX_AGE_SECONDS}`,
        },
    });
    await env.DB.prepare(`INSERT INTO api_cache (cache_key, provider, object_key, expires_at, created_at, last_access_at, cache_meta)
     VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6)
     ON CONFLICT(cache_key) DO UPDATE SET
       provider = excluded.provider,
       object_key = excluded.object_key,
       expires_at = excluded.expires_at,
       last_access_at = excluded.last_access_at,
       cache_meta = excluded.cache_meta`)
        .bind(cacheKey, provider, objectKey, expiresAt, now, cacheMeta)
        .run();
}
async function writeEdgeCache(req, data) {
    const res = new Response(JSON.stringify(data), {
        headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": `public, max-age=${CACHE_MAX_AGE_SECONDS}`,
        },
    });
    await getEdgeCache().put(req, res);
}
async function recordBilling(env, args) {
    const userId = args.userId || "anonymous";
    await env.DB.prepare("INSERT INTO billing_events (user_id, provider, cache_hit, estimated_usd, actual_usd, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
        .bind(userId, args.provider, args.cacheHit, args.estimatedUsd, args.actualUsd, nowEpoch())
        .run();
}
// ── New API handlers ───────────────────────────────────────────────────────
async function handleMe(request, env) {
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
async function handleBillingSummary(request, env) {
    const user = await requireClerkAuth(request, env);
    await ensureD1Schema(env);
    const total = await env.DB.prepare("SELECT COUNT(*) AS events, COALESCE(SUM(estimated_usd), 0) AS estimated, COALESCE(SUM(actual_usd), 0) AS actual FROM billing_events WHERE user_id = ?1")
        .bind(user.userId)
        .first();
    const byProviderRaw = await env.DB.prepare("SELECT provider, COUNT(*) AS events, COALESCE(SUM(estimated_usd),0) AS estimated, COALESCE(SUM(actual_usd),0) AS actual FROM billing_events WHERE user_id = ?1 GROUP BY provider ORDER BY actual DESC")
        .bind(user.userId)
        .all();
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
async function handleAdminListUsers(request, env) {
    await requireAdminAuth(request, env);
    const secretKey = env.CLERK_SECRET_KEY || "";
    if (!secretKey)
        throw new Error("Authentication not configured");
    const res = await fetchWithTimeout("https://api.clerk.com/v1/users?limit=100&order_by=-created_at", { headers: { Authorization: `Bearer ${secretKey}` } }, 8000);
    if (!res.ok)
        throw new Error(`Failed to list users`);
    const users = (await res.json());
    const result = users.map((u) => ({
        userId: u.id,
        email: u.email_addresses?.[0]?.email_address || "",
        approved: u.public_metadata?.approved === true,
        isAdmin: u.public_metadata?.role === "admin" || BUILTIN_ADMIN_EMAILS.has((u.email_addresses?.[0]?.email_address || "").toLowerCase()),
        createdAt: u.created_at,
    }));
    return json({ ok: true, users: result });
}
async function handleAdminApproveUser(request, env) {
    await requireAdminAuth(request, env);
    const body = await requireJson(request);
    const targetUserId = String(body.userId || "").trim();
    const approve = body.approve !== false;
    if (!targetUserId)
        throw new Error("userId is required");
    const secretKey = env.CLERK_SECRET_KEY || "";
    if (!secretKey)
        throw new Error("Authentication not configured");
    const res = await fetchWithTimeout(`https://api.clerk.com/v1/users/${encodeURIComponent(targetUserId)}/metadata`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ public_metadata: { approved: approve } }),
    }, 8000);
    if (!res.ok) {
        throw new Error(`Failed to update user`);
    }
    // Invalidate edge cache for this user
    await getEdgeCache().delete(new Request(`https://cache.local/clerk-user-meta/${targetUserId}`));
    return json({ ok: true, userId: targetUserId, approved: approve });
}
async function handleAdminBillingSummary(request, env) {
    await requireAdminAuth(request, env);
    await ensureD1Schema(env);
    const rows = await env.DB.prepare("SELECT user_id, COUNT(*) AS events, COALESCE(SUM(estimated_usd),0) AS estimated, COALESCE(SUM(actual_usd),0) AS actual, MAX(created_at) AS last_event_at FROM billing_events GROUP BY user_id ORDER BY actual DESC").all();
    const totals = await env.DB.prepare("SELECT COUNT(*) AS events, COALESCE(SUM(estimated_usd),0) AS estimated, COALESCE(SUM(actual_usd),0) AS actual FROM billing_events").first();
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
async function resolveRoadBBox(roadName, countryCode, focusPoint) {
    if (focusPoint && Number.isFinite(focusPoint.lat) && Number.isFinite(focusPoint.lon)) {
        const radius = 0.012;
        return { bbox: { south: focusPoint.lat - radius, north: focusPoint.lat + radius, west: focusPoint.lon - radius, east: focusPoint.lon + radius } };
    }
    const normalizedCountry = /^[a-z]{2}$/.test(countryCode) ? countryCode : "";
    let items = [];
    if (normalizedCountry === "hk") {
        const hkItems = await fetchNominatimSearch(roadName, "hk");
        if (hkItems.length > 0) {
            items = hkItems;
        }
        else {
            for (const q of [`香港${roadName}`, `Hong Kong ${roadName}`, roadName]) {
                const cnItems = await fetchNominatimSearch(q, "cn");
                if (cnItems.length > 0) {
                    items = cnItems;
                    break;
                }
            }
        }
    }
    else if (normalizedCountry) {
        const queryVariants = buildQueryVariants(roadName);
        for (const q of queryVariants) {
            const filteredItems = await fetchNominatimSearch(q, normalizedCountry);
            if (filteredItems.length > 0) {
                items = filteredItems;
                break;
            }
        }
        if (!items.length) {
            for (const q of queryVariants) {
                const anyItems = await fetchNominatimSearch(q, "");
                if (anyItems.length > 0) {
                    items = anyItems;
                    break;
                }
            }
        }
    }
    else {
        items = await fetchNominatimSearch(roadName, "");
    }
    if (!items.length) {
        throw new Error(`Geocode no result for road name "${roadName}" (country: ${countryCode || "any"})`);
    }
    const first = items[0] || {};
    const bb = Array.isArray(first.boundingbox) ? first.boundingbox : [];
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
    }
    else {
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
async function handleClerkWebhook(request, env) {
    const webhookSecret = env.CLERK_WEBHOOK_SECRET || "";
    const rawBody = await request.text();
    if (webhookSecret) {
        const signatureOk = await verifySvixWebhook(request.headers, rawBody, webhookSecret);
        if (!signatureOk) {
            return json({ error: "Invalid webhook signature" }, 400);
        }
    }
    const payload = JSON.parse(rawBody);
    const eventType = String(payload.type || "");
    if (eventType === "user.created") {
        const userId = String(payload.data?.id || "");
        if (userId && env.CLERK_SECRET_KEY) {
            await fetchWithTimeout(`https://api.clerk.com/v1/users/${encodeURIComponent(userId)}/metadata`, {
                method: "PATCH",
                headers: {
                    Authorization: `Bearer ${env.CLERK_SECRET_KEY}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ public_metadata: { approved: false } }),
            }, 8000).catch(() => null);
        }
    }
    return json({ ok: true, event: eventType });
}
async function verifySvixWebhook(headers, body, secret) {
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
    const keyBuffer = keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength);
    const payload = `${svixId}.${svixTimestamp}.${body}`;
    const cryptoKey = await crypto.subtle.importKey("raw", keyBuffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signatureBytes = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(payload)));
    const expected = bytesToBase64(signatureBytes);
    const received = svixSignature
        .split(" ")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
        const [ver, sig] = part.split(",");
        if (ver !== "v1")
            return "";
        return String(sig || "").trim();
    })
        .filter(Boolean);
    return received.some((sig) => constantTimeEqual(sig, expected));
}
function base64Decode(value) {
    try {
        const binary = atob(value);
        return Uint8Array.from(binary, (c) => c.charCodeAt(0));
    }
    catch {
        return null;
    }
}
function constantTimeEqual(a, b) {
    if (a.length !== b.length) {
        return false;
    }
    let out = 0;
    for (let i = 0; i < a.length; i += 1) {
        out |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return out === 0;
}
async function ensureD1Schema(env) {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS api_cache (
      cache_key TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      object_key TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      last_access_at INTEGER NOT NULL
    )`).run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_api_cache_provider_expires ON api_cache(provider, expires_at)").run();
    try {
        await env.DB.prepare("ALTER TABLE api_cache ADD COLUMN cache_meta TEXT").run();
    }
    catch {
        // Column already exists in most environments.
    }
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS billing_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      provider TEXT NOT NULL,
      cache_hit INTEGER NOT NULL,
      estimated_usd REAL NOT NULL,
      actual_usd REAL,
      created_at INTEGER NOT NULL
    )`).run();
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS rate_limits (
      rate_key TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`).run();
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_rate_limits_expires ON rate_limits(expires_at)").run();
}
async function buildCacheKey(provider, payload) {
    const text = `${provider}:${stableStringify(payload)}`;
    const encoded = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", encoded);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function stableStringify(value) {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map((v) => stableStringify(v)).join(",")}]`;
    }
    const obj = value;
    const keys = Object.keys(obj).sort();
    const parts = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
    return `{${parts.join(",")}}`;
}
function nowEpoch() {
    return Math.floor(Date.now() / 1000);
}
function round6(v) {
    return Math.round(v * 1_000_000) / 1_000_000;
}
function round5(v) {
    return Math.round(v * 100_000) / 100_000;
}
function round4(v) {
    return Math.round(v * 10_000) / 10_000;
}
function normalizeHeading(v) {
    const n = v % 360;
    return n < 0 ? n + 360 : n;
}
function headingLabel(heading) {
    const dirs = ["北", "東北", "東", "東南", "南", "西南", "西", "西北"];
    const idx = Math.round(normalizeHeading(heading) / 45) % 8;
    return dirs[idx];
}
function normalizeRoadName(name) {
    return name.toLowerCase().replace(/\s+/g, "").trim()
        .replace(/\u9A5B/g, "\u99C5") // 驛 → 駅
        .replace(/\u7AD9/g, "\u99C5"); // 站 → 駅
}
function buildQueryVariants(query) {
    const variants = [query];
    const v1 = query.replace(/\u9A5B/g, "\u99C5").replace(/\u7AD9/g, "\u99C5");
    if (v1 !== query) variants.push(v1);
    const v2 = query.replace(/\u99C5/g, "\u9A5B");
    if (v2 !== query && !variants.includes(v2)) variants.push(v2);
    return variants;
}
function buildOverpassQuery(bbox) {
    return `
[out:json][timeout:25];
(
  way["highway"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
);
(._;>;);
out body;
`;
}
function parseOverpassData(overpass) {
    const elements = Array.isArray(overpass.elements) ? overpass.elements : [];
    const nodes = new Map();
    const ways = [];
    for (const el of elements) {
        const type = String(el.type || "");
        if (type === "node") {
            const id = Number(el.id);
            nodes.set(id, {
                id,
                lat: Number(el.lat),
                lon: Number(el.lon),
                tags: (el.tags || {}),
            });
        }
        else if (type === "way") {
            ways.push({
                id: Number(el.id),
                nodes: Array.isArray(el.nodes) ? el.nodes : [],
                tags: (el.tags || {}),
            });
        }
    }
    const allHighways = ways.filter((w) => String(w.tags.highway || "").length > 0);
    return { elements, nodes, ways, allHighways };
}
function findTargetWays(allHighways, normRoadName, queryTokens) {
    return allHighways.filter((w) => {
        const names = collectWayNames(w.tags);
        return names.some((rawName) => {
            const name = normalizeRoadName(rawName);
            return isRoadNameMatch(name, normRoadName, queryTokens);
        });
    });
}
function pickPrimaryRoadName(targetWays, fallback) {
    const counts = new Map();
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
function setEquals(a, b) {
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
function expandBBoxByConnectivity(base, targetWays, nodes, maxLatSpan, maxLonSpan) {
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
    let candidate = {
        south: Math.min(base.south, minLat - latPad),
        west: Math.min(base.west, minLon - lonPad),
        north: Math.max(base.north, maxLat + latPad),
        east: Math.max(base.east, maxLon + lonPad),
    };
    let clamped = false;
    const before = { ...candidate };
    candidate = clampBBox(candidate, maxLatSpan, maxLonSpan);
    if (Math.abs(before.south - candidate.south) > 1e-9 ||
        Math.abs(before.west - candidate.west) > 1e-9 ||
        Math.abs(before.north - candidate.north) > 1e-9 ||
        Math.abs(before.east - candidate.east) > 1e-9) {
        clamped = true;
    }
    const changed = Math.abs(base.south - candidate.south) > 1e-6 ||
        Math.abs(base.west - candidate.west) > 1e-6 ||
        Math.abs(base.north - candidate.north) > 1e-6 ||
        Math.abs(base.east - candidate.east) > 1e-6;
    return { bbox: candidate, changed, clamped };
}
function clampBBox(bbox, maxLatSpan, maxLonSpan) {
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
function flattenOrderedNodeIds(ways) {
    const out = [];
    for (const w of ways) {
        for (const nid of w.nodes) {
            out.push(nid);
        }
    }
    return out;
}
function classifyIntersection(linkedWayCount) {
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
function getWayDepartureBearings(way, intersectionNodeId, nodes) {
    const bearings = [];
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
function resolveTurnCandidates(candidates, forwardBearing) {
    if (forwardBearing === null) {
        return { left: null, right: null };
    }
    let left = null;
    let right = null;
    for (const candidate of candidates) {
        const delta = signedBearingDelta(forwardBearing, candidate.bearing);
        if (Math.abs(delta) < 25 || Math.abs(delta) > 155) {
            continue;
        }
        const turn = {
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
function signedBearingDelta(fromBearing, toBearing) {
    let delta = normalizeHeading(toBearing) - normalizeHeading(fromBearing);
    if (delta > 180) {
        delta -= 360;
    }
    if (delta <= -180) {
        delta += 360;
    }
    return delta;
}
function turnCandidateScore(candidate) {
    return Math.abs(90 - Math.abs(candidate.delta));
}
function dedupeIntersections(rows) {
    const seen = new Set();
    const out = [];
    for (const row of rows) {
        if (seen.has(row.id)) {
            continue;
        }
        seen.add(row.id);
        out.push(row);
    }
    return out;
}
function bearingDegrees(a, b) {
    const phi1 = (a.lat * Math.PI) / 180;
    const phi2 = (b.lat * Math.PI) / 180;
    const lambda1 = (a.lon * Math.PI) / 180;
    const lambda2 = (b.lon * Math.PI) / 180;
    const y = Math.sin(lambda2 - lambda1) * Math.cos(phi2);
    const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambda2 - lambda1);
    return normalizeHeading((Math.atan2(y, x) * 180) / Math.PI);
}
function sampleLineByMeters(start, end, intervalMeters) {
    const total = haversineMeters(start, end);
    if (total <= 0) {
        return [start];
    }
    const count = Math.max(1, Math.ceil(total / intervalMeters));
    const points = [];
    for (let i = 0; i <= count; i += 1) {
        const t = i / count;
        points.push({
            lat: start.lat + (end.lat - start.lat) * t,
            lon: start.lon + (end.lon - start.lon) * t,
        });
    }
    return points;
}
function haversineMeters(a, b) {
    const R = 6_371_000;
    const p1 = (a.lat * Math.PI) / 180;
    const p2 = (b.lat * Math.PI) / 180;
    const dPhi = ((b.lat - a.lat) * Math.PI) / 180;
    const dLambda = ((b.lon - a.lon) * Math.PI) / 180;
    const x = Math.sin(dPhi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLambda / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
