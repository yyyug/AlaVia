# AlaVia System Architecture

## Overview

AlaVia is a blind-accessible map navigation system built on Cloudflare Workers with a sophisticated multi-layer caching architecture. It integrates multiple external APIs to provide text-based, AI-generated descriptions of street scenes and intersections.

```
┌─────────────────────┐
│   Web Browser       │
│  (HTML + JS App)    │
└────────┬────────────┘
         │ HTTP/JSON
         ▼
┌─────────────────────────────────────────┐
│     Cloudflare Workers (TypeScript)     │
│  - Route handling                       │
│  - API orchestration                    │
│  - Cache layer management               │
└────┬──────────────┬────────────┬────────┘
     │              │            │
     ▼              ▼            ▼
┌──────────┐  ┌──────────┐  ┌──────────┐
│  D1 DB   │  │    R2    │  │ External │
│(Metadata)│  │ (Images) │  │   APIs   │
└──────────┘  └──────────┘  └──────────┘
```

## Core Components

### 1. Frontend (`public/app.js`, `public/index.html`)

**Purpose**: User interface for blind users with text-based navigation

**Features**:
- Keyboard navigation (arrow keys, Enter, ESC)
- Screen reader optimized
- Multi-language UI (zh-Hant, en, ja, ko)
- Real-time cost estimation and cache hit tracking
- Interactive intersection browser with left/right turn navigation

**Tech Stack**:
- Vanilla JavaScript (no frameworks for accessibility)
- HTML5 semantic markup
- CSS Grid for responsive layout
- i18n dictionary system with language switching

**Key Sections**:
```javascript
// State management
state = {
  roadName: string,          // Current search query
  intersections: array,      // Current route intersections
  focusedIndex: number,      // Currently viewed intersection
  uiLang: string,           // UI language (zh-Hant, en, ja, ko)
}

// API call handlers
handleSearchRoad()           // Geocode + segment intersection lookup
handleStreetviewClick()      // Fetch AI descriptions
handleNearbyClick()          // Search landmarks
handleNextIntersection()     // Navigate to next intersection
handleTurnLeft/Right()       // Navigate to connected streets
```

### 2. Backend Worker (`src/worker.ts`)

**Purpose**: Central API orchestrator handling request routing, caching, and third-party API coordination

**~2500 lines of TypeScript** organized into sections:

#### Route Handlers
Each endpoint handles a specific user request:

- **Geocoding**: `POST /api/geocode/autobbox` - Convert address → bounding box
- **Intersection Lookup**: `POST /api/overpass/segment` - Find intersections on a road
- **Street View**: `POST /api/paid/streetview` - Get images and AI descriptions
  - Fetches 2 headings: left (+90°) and right (+270°)
  - Generates Gemini 3 Flash Lite descriptions
  - Pre-checks metadata to avoid wasted API calls
- **Landmarks**: 
  - `POST /api/paid/places` - Google Places API
  - `POST /api/osm/route-places` - OSM data between points
- **Admin**: `POST /api/admin/cleanup-noimage`, `/api/admin/streetview-storage` - Cache management

#### Caching Strategy (3 Layers)

```
Request arrives
    │
    ▼ Layer 1: Cloudflare Edge Cache
   Hit? ─→ Return cached response
    │
    No
    ▼ Layer 2: D1 Metadata Index
   Found? ─→ Layer 3: Fetch from R2 blob storage
    │
    No
    ▼ Layer 4: External API Call
   Fetch from Google/OSM/Gemini
    │
    ▼ Store in all 3 layers
   Return response
```

**Cache Providers**:
- `places` - Google Places search results
- `streetview-image-v1` - Street View images (stored in R2)
- `streetview-gemini-text-v1` - AI descriptions
- `osm-segment` - OSM road segments
- `osm-places` - OSM landmarks

**Key Cache Functions**:
```typescript
getOrCreateCached(
  env: Env,
  provider: string,
  payload: Json,
  fetchFn: () => Promise<Json>,
  ttlSeconds: number
): Promise<CacheEntry>
```

Implements automatic revalidation logic with smart TTLs (1 year for streets, 1 day for real-time data).

#### Helper Functions

**API Callers**:
- `fetchNominatimSearch()` - OpenStreetMap geocoding
- `fetchOverpassJson()` - OSM intersection queries
- `fetchStreetViewMetadata()` - Check Street View coverage (free)
- `fetchImageBytes()` - Download Street View images
- `fetchGeminiDescription()` - AI image description generation
- `fetchGooglePlaces()` - Nearby landmark search

**Cache Operations**:
- `buildCacheKey()` - SHA256 hash of request payload
- `storeStreetViewImage()` - R2 object storage
- `getEdgeCache()` - Cloudflare edge cache layer

**Utilities**:
- `round6()` - Coordinate rounding for cache key consistency
- `normalizeHeading()` - Convert bearing to 0-360 range
- `normalizeMapsLanguage()` - Validate language codes
- `metersToLatDegrees()` / `metersToLonDegrees()` - Coordinate calculations

#### Request Handling Pattern

```typescript
async function handlePaidStreetView(request, env, ctx) {
  // 1. User authentication check
  requireAllowedUser(request, env);
  
  // 2. Database schema setup
  await ensureD1Schema(env);
  
  // 3. Request parsing & validation
  const body = await requireJson(request);
  requireUserConfirmedPaidCall(body);
  
  // 4. Parameter extraction & normalization
  const lat = Number(body.lat), lon = Number(body.lon);
  
  // 5. Key retrieval & validation
  const mapsKey = requireGoogleMapsKey(env);
  const geminiKey = requireGeminiKey(env);
  
  // 6. Process request with caching
  for (const view of views) {
    // 6a. Pre-check metadata (free, prevents wasted calls)
    const metaStatus = await fetchStreetViewMetadata(mapsKey, lat, lon);
    if (metaStatus === "ZERO_RESULTS") continue; // Skip if no coverage
    
    // 6b. Get or fetch image (cached or API)
    const imageCached = await getOrCreateCached(env, provider, payload, async () => {
      const bytes = await fetchImageBytes(imageUrl);
      return { imageUrl, imageObjectKey };
    });
    
    // 6c. Get or generate description (cached or API)
    const textCached = await getOrCreateCached(env, provider, payload, async () => {
      const description = await fetchGeminiDescription(geminiKey, imageBase64);
      return { description };
    });
  }
  
  // 7. Billing tracking
  await recordBilling(env, {
    provider: "streetview",
    estimatedUsd: calculateEstimate(),
    actualUsd: calculateActual(),
  });
  
  // 8. Response with rich metadata
  return json({
    ok: true,
    provider: "streetview",
    estimatedCalls: 4,
    billableCalls: 2,
    cacheHits: 2,
    text: formattedDescription,
  });
}
```

### 3. Database (D1 SQLite)

**Purpose**: Metadata tracking and billing events

**Tables**:

#### `api_cache`
```sql
CREATE TABLE api_cache (
  cache_key TEXT PRIMARY KEY,      -- SHA256(provider + payload)
  provider TEXT NOT NULL,           -- Cache provider name
  object_key TEXT NOT NULL,         -- R2 object reference
  bytes INTEGER,                    -- Object size in bytes
  created_at DATETIME DEFAULT NOW(),
  expires_at DATETIME               -- TTL-based expiration
);

CREATE INDEX idx_cache_provider ON api_cache(provider);
```

**Purpose**: Track all cached objects for cleanup and statistics

#### `billing_events`
```sql
CREATE TABLE billing_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,           -- Service: places, streetview, etc
  estimated_calls INTEGER,          -- Expected API calls
  billable_calls INTEGER,           -- Actual paid calls made
  cache_hits INTEGER,               -- Cached responses reused
  estimated_usd REAL,               -- Expected cost
  actual_usd REAL,                  -- Actual cost incurred
  created_at DATETIME DEFAULT NOW()
);
```

**Purpose**: Cost tracking and usage analytics

### 4. Object Storage (R2 Bucket: `alavia-cache`)

**Purpose**: Persistent cache storage for large binary objects

**Directory Structure**:
```
alavia-cache/
├── streetview-images/
│   └── [SHA256].jpg              -- Street View images (70-80 KB each)
├── osm-segments/
│   └── [SHA256].json             -- OSM segment data
└── places/
    └── [SHA256].json             -- Google Places results
```

**Storage Strategy**:
- Images stored as JPEG to minimize size
- JSON responses stored compressed
- SHA256 hash ensures deduplication
- Edge cache headers set for performance

### 5. External APIs Integration

#### Google Maps API
- **Street View Metadata**: Check coverage before fetching ($0.007/call)
- **Street View Static**: Download 90° field-of-view images
- **Geocoding**: Address to coordinates
- **Places Nearby**: Landmark search within radius
- **Language Support**: Translates results to target language

**API Keys**: `GOOGLE_MAPS_API_KEY`, `GOOGLE_VISION_API_KEY` (legacy)

#### OpenStreetMap / Overpass
- **Free service** (no API key needed)
- **Intersection Detection**: Find all intersections on a road
- **Route Analysis**: Get OSM tags (name, type, source)
- **Landmark Query**: OSM POI data between two points

**Smart Usage**: 
- Bounding box queries to minimize data transfer
- Timeout after 8s to prevent worker hanging
- Timeout-based retries with growth ratio validation

#### Google Gemini 3 Flash Lite API
- **Image Description**: Generate text descriptions from Street View images
- **Prompt Engineering**: Consistent format focusing on street crossing challenges
- **Language Support**: Multilingual descriptions
- **Cost**: ~$0.00005 per call

**Prompt Used**:
> You are assisting a blind person navigate a street intersection. Describe what you see in this street scene focusing on: 1) Road characteristics (width, markings, traffic lights, signs). 2) Pedestrian infrastructure (curbs, crossings, signals). 3) Nearby landmarks or shops. Be concise and practical for navigation.

### 6. Batch Processing Script (`scripts/prefetch-hk-streets.mjs`)

**Purpose**: Warm caches for entire street networks to optimize user experience

**Process**:
1. Load indexed street list from `hk-streets.json` (6656 Hong Kong streets)
2. For each street in selected range:
   - Geocode address to bounding box
   - Query Overpass for intersections
   - For each intersection:
     - **Check Street View metadata** (free check prevents wasted API calls)
     - If coverage exists: Fetch images + generate descriptions
     - Fetch OSM landmarks on segments
3. All responses cached in R2 automatically by worker

**Example**: Processing streets 1-300:
- ~3000 intersections analyzed
- ~2000 with Street View coverage
- ~6000 API calls avoided by metadata pre-check
- ~210 KB of images + 300 KB of descriptions stored
- **Cost saved**: ~$30-50 in API calls by using cached data

### 7. Metadata Check Optimization

**New in Latest Version**: Metadata pre-checks before expensive API calls

**Flow**:
```
prefetch-hk-streets.mjs
    │
    ├─→ /api/streetview/metadata (free check)
    │   Query: {lat, lon}
    │   Response: {hasStreetView: boolean, metadataStatus}
    │   
    ├─ hasStreetView: true?
    │  ├─ Yes: Call /api/paid/streetview (uses image + description quota)
    │  └─ No: Skip (saves $0.0141 per intersection)
    │
    └─→ /api/osm/route-places (always free)
```

**Result**: ~70% of intersections skipped due to no Street View coverage, reducing batch prefetch cost by 5-10x.

## Data Flow

### User Request: "Search for street intersection descriptions"

```
1. User types: "中山路 Hong Kong" → clicks Search
   
2. Frontend calls POST /api/geocode/autobbox
   Params: {query, countryCode: "HK", bbox (optional)}
   
3. Worker:
   - Checks edge cache (hit? return)
   - Checks D1 metadata index (hit? fetch from R2)
   - Calls Nominatim geocoding API
   - Stores result in cache layers
   
4. Frontend receives bbox, calls POST /api/overpass/segment
   Params: {roadName, bbox}
   
5. Worker:
   - Calls Overpass API with bbox query
   - Gets [lat, lon, name, bearingToNext] for each intersection
   - Caches in D1 + R2
   
6. Frontend displays intersection list, user clicks "Street Details"
   
7. Frontend calls POST /api/paid/streetview (requires user confirmation)
   Params: {lat, lon, heading, userConfirmedPaidCall: true}
   
8. Worker processes:
   a. Check metadata (free): hasStreetView?
   b. Get image (paid): Cache or fetch from Google
   c. Get description (paid): Cache or fetch from Gemini
   d. Return both for left/right headings
   
9. Frontend displays text description + cost estimate
   
10. User navigates to next intersection (cached) or turns left/right
```

## Caching Performance

**Example: Viewing 5 intersections on one street**

| Action | API Calls | Cost | Cache Status |
|--------|-----------|------|--------------|
| 1st view | 4 (2 images + 2 Gemini) | $0.014 | New |
| 2nd view (same intersection) | 0 | $0 | Edge cache hit |
| 3rd view (diff intersection, same street) | 4 | $0.014 | New |
| 4th view (repeat of 1st) | 0 | $0 | R2 + D1 hit |
| 5th view (new data) | 4 | $0.014 | New |

**Total for 5 views**: 8 paid calls, 4 cached calls, ~$0.028 cost

**With prefetch**: 0 paid calls if already warmed, $0 cost

## Security Architecture

1. **Authentication**: Optional email verification via Cloudflare Access
2. **Input Validation**: 
   - Coordinate bounds checked (±180 lon, ±90 lat)
   - Query strings limited to 200 chars
   - Language codes whitelisted (en, zh-TW, ja, ko)
3. **Rate Limiting**: Implicit via Cloudflare Workers quota
4. **Secret Management**: 
   - Dev: `.dev.vars` file (local only)
   - Prod: Cloudflare Secrets environment
5. **Error Handling**: Generic error messages to prevent information disclosure

## Performance Characteristics

**Latency**: 
- Cached response: <100ms (edge cache + D1)
- New API call: 1-3s (depends on external API)
- Metadata check: 500ms

**Storage**:
- Per intersection: ~1 image (75 KB) + 1 description (5 KB) = 80 KB
- 100 intersections: ~8 MB
- 1000 intersections: ~80 MB

**Cost per 1000 intersections**:
- Street View images: $7
- Gemini descriptions: ~$0.10
- Total: ~$7.10 (or $0 if cached)

## Deployment

See `wrangler.toml`:
```toml
[env.production]
routes = [
  {pattern = "example.com/*", zone_name = "example.com"}
]

[env.production.vars]
ALLOWED_ACCESS_EMAILS = "user@example.com"

[[env.production.kv_namespaces]]
binding = "CACHE"
id = "production_cache_id"
```

## Future Improvements

1. **Circuit Breaker Pattern** for failing APIs
2. **Structured Logging** for observability
3. **Request Rate Limiting** per IP/user
4. **Timeout Handling** for all external calls
5. **Error Type Hierarchy** for consistency
6. **Metrics Collection** (Prometheus-compatible)
7. **Simplified Caching** (remove D1 layer, use R2 only)

---

**Last Updated**: May 2, 2026  
**Architecture Version**: 2.0
