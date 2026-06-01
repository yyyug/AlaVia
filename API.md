# AlaVia Backend Reference

Last updated: 2026-05-20

This file is the single source of truth for AlaVia backend architecture, API contracts, build/deploy commands, and operational checks.

## 1) Runtime Architecture

- Platform: Cloudflare Workers (TypeScript, ES modules)
- Main entry: src/worker.ts
- Primary data stores:
  - D1: cache metadata, billing events, user/rate-limit records, tile access stats
  - R2: cached payload blobs and hot tile cache
  - Optional R2 PMTiles archive: pmtiles/hongkong-z16.pmtiles
- External APIs:
  - OpenStreetMap Nominatim (search/reverse)
  - OpenStreetMap Overpass
  - Google Maps APIs (Street View, Places)
  - Gemini API (text generation)

### Cache Model

- Edge cache (Cloudflare cache API)
- D1 metadata index
- R2 object body cache
- Typical TTLs:
  - geocode/OSM stable data: long TTL (up to 365 days)
  - paid APIs: cached by normalized payload keys

## 2) Code Structure (Current Split)

- src/worker.ts
  - Router + handlers + service orchestration
- src/config/constants.ts
  - Shared constants and price table
- src/lib/geo-utils.ts
  - Coordinate, heading, distance, and normalization helpers
- src/services/cache.ts
  - Shared cache keying, edge/R2/D1 cache lifecycle, and billing write helper
- src/services/gateway-policy.ts
  - Access-policy enforcement and reusable rate-limit guard
- src/services/schema.ts
  - D1 schema bootstrap and index creation lifecycle
- src/services/tiles.ts
  - SoundScape tile pipeline (R2 hot cache -> PMTiles -> Neon -> Overpass fallback)

This split intentionally keeps behavior unchanged while reducing worker.ts growth pressure.

## 3) API Endpoint Index

All endpoints use JSON request/response unless noted.

### Core Geo / OSM

- POST /api/geocode/autobbox
  - Purpose: forward geocode + bounding context
- POST /api/geocode/reverse-road
  - Purpose: reverse geocode and extract road
- POST /api/overpass/segment
  - Purpose: intersection list on a road segment
- POST /api/intersections/near
  - Purpose: combined reverse + segment lookup
  - Optional request field: `heading` in degrees
  - Adds `nearestForwardIntersection`, including distance and bearing from the
    requested position plus available left/right turn roads and angles
- POST /api/intersections/address-batch
  - Purpose: reverse-address enrichment batch
  - Supports two request modes:
    - iOS mode:
      {
        "coordinates": [{"lat": 22.28, "lon": 114.14}]
      }
      Response:
      {
        "addresses": [
          {
            "lat": 22.28,
            "lon": 114.14,
            "streetName": "...",
            "subThoroughfare": "...",
            "addressLine": "..."
          }
        ]
      }
    - legacy mode:
      {
        "roadName": "...",
        "points": [{"id": 1, "idx": 0, "lat": 22.28, "lon": 114.14}],
        "maxItems": 8
      }

### Tile / Spatial

- GET /tiles/{z}/{x}/{y}.json
  - Purpose: SoundScape-compatible tile endpoint
  - Source priority: R2 hot cache -> PMTiles -> Neon/PostGIS -> Overpass -> empty tile
- POST /api/osm/tile
- POST /api/osm/scan-nearby
- POST /api/osm/places-around
- POST /api/osm/route-places
- POST /api/google/route-places

### Paid / Street View / AI

- POST /api/paid/places
- POST /api/paid/streetview
- POST /api/paid/streetview/panorama-describe
- POST /api/paid/route-scenery
- POST /api/streetview/metadata
- POST /api/streetview/resolve-pano
- POST /api/streetview/find-indoor-entry
- POST /api/streetview/indoor-step
- POST /api/streetview/analyze-link

### Admin / Auth / Billing

- POST /api/config/maps-key
- GET /api/me
- GET /api/billing/summary
- GET /api/admin/users
- GET /api/admin/billing-summary
- POST /api/admin/approve-user
- GET /api/admin/cache-stats
- POST /api/admin/cache-purge-expired
- GET /api/admin/cache-streets
- POST /api/admin/cleanup-noimage
- POST /api/admin/streetview-storage
- POST /api/clerk/webhook

## 4) Build, Debug, Deploy

### Build

- npm run build

### Local debug

- npm run dev
- Validate key routes with curl/Invoke-WebRequest

### Production deploy

- npm run deploy
- Use explicit environment to avoid mistakes:
  - wrangler deploy --env=""
  - or wrangler deploy --env=<name>

### SoundScape tile cache refresh

- Clear old objects before repopulating when tile schema changes:
  - npm run tiles:clear
- Re-warm HK tile hot cache after deploy:
  - npm run prefetch:hk -- --from 1 --to <n> --warmTiles true --warmTileRepeats 3

### Neon soundscape_tile() function alignment

- Canonical SQL is versioned at:
  - sql/soundscape_tile.sql
- Apply to Neon/PostGIS with:
  - NEON_DSN="..." npm run neon:apply:soundscape-tile

### Fast smoke checks

- Tile endpoint:
  - GET /tiles/16/{x}/{y}.json
- Address batch:
  - POST /api/intersections/address-batch with coordinates array

## 5) Contract Guardrails

- Do not change response field names used by iOS without versioning.
- /api/intersections/address-batch must keep iOS mode output fields:
  - streetName
  - subThoroughfare
  - addressLine
- Keep SoundScape tile feature keys stable:
  - type, osm_ids, feature_type, feature_value, geometry, properties

## 6) Suggested Next Split Steps

- Extract router declaration to src/router/
- Move handlers by domain:
  - src/handlers/geocode.ts
  - src/handlers/osm.ts
  - src/handlers/streetview.ts
  - src/handlers/admin.ts

Completed service extractions in this phase:
- src/services/cache.ts
- src/services/gateway-policy.ts
- src/services/schema.ts
- src/services/tiles.ts

These should be done incrementally with snapshot commits and build checks each step.
