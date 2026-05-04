# AlaVia API Reference

All endpoints use `application/json` content type. Responses follow a consistent structure with `ok` field indicating success.

## Authentication

**Local Development**: No authentication required  
**Production**: Optional email verification via Cloudflare Access headers

```javascript
// Request header (production only)
{
  "cf-access-authenticated-user-email": "user@example.com"
}
```

## Base URL

- **Development**: `http://127.0.0.1:8787`
- **Production**: `https://alavia.example.com`

---

## Geocoding APIs

### POST `/api/geocode/autobbox`

Convert an address or road name to bounding box coordinates.

**Request**:
```json
{
  "query": "中山路 Hong Kong",
  "countryCode": "HK",
  "bbox": [113.8, 22.2, 114.3, 22.5]  // Optional: suggest search area
}
```

**Response** (success):
```json
{
  "ok": true,
  "query": "中山路 Hong Kong",
  "countryCode": "HK",
  "name": "Central and Western District, Hong Kong",
  "lat": 22.2843,
  "lon": 114.1477,
  "bbox": [114.13, 22.27, 114.16, 22.30],
  "confidence": 0.95,
  "cacheHit": false
}
```

**Response** (no results):
```json
{
  "ok": true,
  "query": "Nonexistent Road",
  "countryCode": "HK",
  "name": null,
  "bbox": null,
  "results": []
}
```

**Parameters**:
- `query` (required) - Address or street name
- `countryCode` (optional) - Country code (e.g., "HK", "TW", "CN") to prioritize results
- `bbox` (optional) - [minLon, minLat, maxLon, maxLat] for search region

**Cache**: 1 year (geographic data is stable)

**Cost**: FREE (uses OpenStreetMap Nominatim)

---

## Intersection APIs

### POST `/api/overpass/segment`

Find all intersections (named points) along a road within a bounding box.

**Request**:
```json
{
  "roadName": "中山路",
  "bbox": [114.13, 22.27, 114.16, 22.30]
}
```

**Response**:
```json
{
  "ok": true,
  "roadName": "中山路",
  "bbox": [114.13, 22.27, 114.16, 22.30],
  "intersections": [
    {
      "lat": 22.2869,
      "lon": 114.1456,
      "name": "中山路 & 威靈頓街",
      "type": "crossing",
      "source": "target_road",
      "bearingToNext": 45,
      "nextDistance": 120
    },
    {
      "lat": 22.2845,
      "lon": 114.1478,
      "name": "中山路 & 德己立街",
      "type": "t_junction",
      "source": "target_road",
      "bearingToNext": 48,
      "nextDistance": 95
    }
  ],
  "estimatedRoadLength": 1523,
  "cacheHit": false
}
```

**Parameters**:
- `roadName` (required) - Street name to find intersections on
- `bbox` (required) - [minLon, minLat, maxLon, maxLat] search area

**Cache**: 30 days (OSM data updates occasionally)

**Cost**: FREE (uses OpenStreetMap Overpass)

**Notes**:
- Returns up to 100 intersections per query
- `bearingToNext` is compass heading (0-360°) to next intersection
- `nextDistance` is approximate distance to next intersection in meters

---

## Street View APIs

### POST `/api/streetview/metadata`

Check if Street View coverage exists at a location (free metadata check).

**Request**:
```json
{
  "lat": 22.2869,
  "lon": 114.1456
}
```

**Response**:
```json
{
  "ok": true,
  "lat": 22.2869,
  "lon": 114.1456,
  "metadataStatus": "OK",
  "hasStreetView": true
}
```

**Status Values**:
- `"OK"` - Street View available
- `"ZERO_RESULTS"` - No Street View coverage
- `"NOT_FOUND"` - Invalid coordinates
- `"ERROR"` - API error

**Cache**: None (always fresh)

**Cost**: FREE (uses Google Street View Metadata API)

---

### POST `/api/paid/streetview`

Fetch Street View images and AI-generated descriptions (left/right views).

**Request**:
```json
{
  "lat": 22.2869,
  "lon": 114.1456,
  "heading": 45,
  "fov": 90,
  "pitch": 0,
  "language": "zh-TW",
  "userConfirmedPaidCall": true
}
```

**Response**:
```json
{
  "ok": true,
  "provider": "streetview",
  "estimatedCalls": 4,
  "billableCalls": 2,
  "cacheHits": 2,
  "imageCacheHits": 1,
  "geminiCacheHits": 1,
  "billableImages": 1,
  "billableGemini": 1,
  "estimatedUsd": 0.0141,
  "actualUsd": 0.0070,
  "text": "街景詳細描述完成。\n預估請求 4 次，預估費用 $0.0141。\nStreet View：新請求 1 次，圖片快取命中 1 次。\nGemini：新請求 1 次，描述快取命中 1 次。\n實際費用 $0.0070。\n\n左側：前方是一條寬闊的中山路，有清晰的人行道和交通燈。右側有商店。\n右側：右手邊是威靈頓街交叉口，有斑馬線和交通信號。"
}
```

**Parameters**:
- `lat`, `lon` (required) - Coordinates
- `heading` (optional, default 0) - Camera direction (0-360°, bearing)
- `fov` (optional, default 90) - Field of view (90 typical)
- `pitch` (optional, default 0) - Camera tilt (-90 to 90)
- `language` (optional, default "zh-TW") - Response language (en, zh-TW, ja, ko)
- `userConfirmedPaidCall` (required) - Must be `true` to confirm paid API use

**Cache**: 365 days (images don't change)

**Cost**: 
- Street View Image: $0.007 per image
- Gemini 3 Flash Lite: ~$0.00005 per description
- **Estimated per call**: ~$0.0141 (2 images + 2 descriptions)

**Response Fields**:
- `text` - Formatted human-readable description
- `billableCalls` - Actual API calls made (sum of images + gemini)
- `cacheHits` - Responses fetched from cache
- `billableImages` - New Street View images fetched
- `billableGemini` - New Gemini descriptions generated
- `actualUsd` - Actual cost incurred

**Street View Headings**:
The function generates descriptions for 2 directions:
- **Left (+90° from heading)**: Perpendicular view to the left
- **Right (+270° from heading)**: Perpendicular view to the right

This provides a complete view of the street intersection from the user's perspective.

---

## Landmark APIs

### POST `/api/paid/places`

Get nearby landmarks using Google Places API.

**Request**:
```json
{
  "intersections": [
    {"lat": 22.2869, "lon": 114.1456, "name": "中山路 & 威靈頓街"},
    {"lat": 22.2845, "lon": 114.1478, "name": "中山路 & 德己立街"}
  ],
  "radius": 50,
  "language": "zh-TW",
  "userConfirmedPaidCall": true
}
```

**Response**:
```json
{
  "ok": true,
  "provider": "places",
  "estimatedCalls": 2,
  "billableCalls": 1,
  "cacheHits": 1,
  "estimatedUsd": 0.064,
  "actualUsd": 0.032,
  "text": "周邊地標查詢完成。\n預估請求 2 次，預估費用 $0.064。\n實際計費 1 次，cache 命中 1 次，實際費用 $0.032。\n\n中山路 & 威靈頓街\n- 中山咖啡館（coffee_shop）\n- 永豐銀行（bank）\n\n中山路 & 德己立街\n- 百樂超市（grocery_store）"
}
```

**Parameters**:
- `intersections` (required) - Array of {lat, lon, name?}
- `radius` (optional, default 50) - Search radius in meters (max 500)
- `language` (optional, default "zh-TW") - Results language
- `userConfirmedPaidCall` (required) - Must be `true`

**Cache**: 365 days

**Cost**: $0.032 per intersection

---

### POST `/api/osm/route-places`

Get OSM landmarks between two points (free).

**Request**:
```json
{
  "roadName": "中山路",
  "start": {"lat": 22.2869, "lon": 114.1456},
  "end": {"lat": 22.2845, "lon": 114.1478}
}
```

**Response**:
```json
{
  "ok": true,
  "roadName": "中山路",
  "segmentDistance": 120,
  "places": [
    {
      "name": "中山咖啡館",
      "type": "cafe",
      "tags": {"amenity": "cafe"}
    },
    {
      "name": "中山藥房",
      "type": "pharmacy",
      "tags": {"amenity": "pharmacy"}
    }
  ],
  "text": "沿街地點（OSM）：中山咖啡館（cafe）、中山藥房（pharmacy）"
}
```

**Cache**: 30 days

**Cost**: FREE

---

## Admin/Management APIs

### POST `/api/admin/cleanup-noimage`

Remove cache entries where Street View had no coverage.

**Request**:
```json
{
  "provider": "streetview-image-v1"
}
```

**Response**:
```json
{
  "ok": true,
  "provider": "streetview-image-v1",
  "scannedCount": 150,
  "deletedNoImageCount": 47
}
```

**Parameters**:
- `provider` (optional, default "streetview-image-v1") - Cache provider to clean

**Auth**: Required (admin only)

**Effect**: Deletes all entries from D1 metadata index and R2 storage where no Street View coverage exists

---

### POST `/api/admin/streetview-storage`

Get detailed statistics about Street View cache storage.

**Request**:
```json
{}
```

**Response**:
```json
{
  "ok": true,
  "provider": "streetview-image-v1",
  "cacheEntryCount": 3,
  "imageObjectCount": 3,
  "noImageEntryCount": 0,
  "missingCacheObjectCount": 0,
  "missingImageObjectCount": 0,
  "totalBytes": 217209,
  "totalKilobytes": 212.12,
  "items": [
    {
      "cacheKey": "4032e8c6b1f5ae1c4aed393fca03e5be772939a514bed9ccc9d28ff8ce0280b3",
      "imageObjectKey": "streetview-images/5555f880d9ef890f249d5a69c5b6ccbbfd476dc9d7c14dc057641ef0c6c0e0c9.jpg",
      "bytes": 69770
    }
  ]
}
```

**Auth**: Required (admin only)

---

## Response Format

All responses follow this pattern:

**Success**:
```json
{
  "ok": true,
  "provider": "streetview",
  "data": {...}
}
```

**Error**:
```json
{
  "error": "User-friendly error message"
}
```

**HTTP Status Codes**:
- `200` - Success
- `400` - Bad request (missing required parameters)
- `401` - Unauthorized (wrong/missing auth)
- `403` - Forbidden (IP/email not allowed)
- `500` - Server error

---

## Error Handling

Common errors:

| Error | Cause | Solution |
|-------|-------|----------|
| "lat and lon are required" | Missing coordinates | Provide valid numbers |
| "Paid API calls require explicit user action" | `userConfirmedPaidCall` not true | Add confirmation |
| "GOOGLE_MAPS_API_KEY is not configured" | Missing API key | Set environment variable |
| "Request must use application/json" | Wrong content type | Use `Content-Type: application/json` |
| "This API is restricted to invited users" | Unauthorized access (prod) | Use allowed email |

---

## Rate Limiting

- **Cloudflare Workers**: 100,000 requests/day per account
- **Google APIs**: Subject to quota in Google Cloud Console
- **OpenStreetMap**: Best effort, no hard limits

---

## Example: Full Intersection Navigation

```javascript
// 1. Geocode address
POST /api/geocode/autobbox
{ "query": "中山路 Hong Kong", "countryCode": "HK" }
→ Get bbox and name

// 2. Find intersections
POST /api/overpass/segment
{ "roadName": "中山路", "bbox": [...] }
→ Get 17 intersections

// 3. Check Street View coverage (free)
POST /api/streetview/metadata
{ "lat": 22.2869, "lon": 114.1456 }
→ Get hasStreetView: true

// 4. If coverage exists, get description (paid)
POST /api/paid/streetview
{ "lat": 22.2869, "lon": 114.1456, "userConfirmedPaidCall": true }
→ Get 2 images + 2 descriptions for $0.0141

// 5. Get nearby landmarks (optional)
POST /api/paid/places
{ "intersections": [...], "userConfirmedPaidCall": true }
→ Get nearby POIs for $0.032

// Total cost for 1 intersection: ~$0.0461 (or $0 if cached)
```

---

**Last Updated**: May 2, 2026  
**API Version**: 2.0
