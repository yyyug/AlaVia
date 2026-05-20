# AlaVia - Text-Based Map Navigation System

A sophisticated, accessible map navigation system for blind and visually impaired users. AlaVia provides detailed text descriptions of street intersections, nearby landmarks, and routes using multiple data sources (Google Maps, OpenStreetMap, Gemini AI).

## 🎯 Features

- **Text-Based Navigation**: Navigate using keyboard commands or on-screen buttons
- **Multi-Language Support**: 繁體中文, English, 日本語, 한국어
- **Street Scene AI Descriptions**: Gemini 3 Flash Lite generates detailed descriptions of street views from multiple angles (left/right)
- **Intersection Analysis**: Shows street type, address sources, and directional information
- **Multi-Source Data**: Combines Google Maps (Places, Street View), OpenStreetMap, and Gemini AI
- **Efficient Caching**: 3-layer caching (edge + database + R2 object storage) to minimize API calls
- **Batch Processing**: Pre-fetch entire street networks to warm caches

## 📋 System Requirements

- **Node.js** 18+
- **npm** or **yarn**
- **Wrangler CLI** (for Cloudflare deployment)
- **Environment Variables**: See `.env.example`

## 🚀 Quick Start

### Local Development

1. **Clone and install:**
   ```bash
   git clone <repository>
   cd AlaVia
   npm install
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.example .dev.vars
   # Edit .dev.vars with your API keys
   ```

3. **Start development server:**
   ```bash
   npm run dev
   ```
   Opens at `http://127.0.0.1:8787`

4. **Run tests:**
   ```bash
   npm run check
   ```

### Batch Processing (Hong Kong Streets)

Pre-fetch and cache entire streets:

```bash
# Process streets 1-300 from indexed HK street list
npm run prefetch:hk -- --from 1 --to 300

# Single street test
npm run prefetch:hk -- --from 1 --to 1

# Refresh street list from Overpass
npm run prefetch:hk -- --from 1 --to 100 --refreshStreetList true

# Custom base URL and language
npm run prefetch:hk -- --from 1 --to 50 --baseUrl https://example.com --language en
```

**Parameters:**
- `--from <n>` - Start index in street list (default: 1)
- `--to <n>` - End index in street list (default: from value)
- `--language <code>` - Language for descriptions: `zh-TW`, `en`, `ja`, `ko` (default: `zh-TW`)
- `--baseUrl <url>` - API base URL (default: env ALAVIA_BASE_URL or http://127.0.0.1:8787)
- `--refreshStreetList` - Force refresh street index from Overpass (default: false)

## 📦 Project Structure

```
AlaVia/
├── src/
│   ├── worker.ts                # Main backend: routes, API handlers, caching
│   ├── config/constants.ts      # Shared constants and pricing
│   ├── lib/geo-utils.ts         # Shared geo/heading/math helpers
│   └── services/
│       ├── cache.ts             # Cache lifecycle + billing helper
│       ├── gateway-policy.ts    # Access control + rate limiting policy
│       ├── schema.ts            # D1 schema bootstrap and indexes
│       └── tiles.ts             # SoundScape tile pipeline orchestration
├── public/
│   ├── app.js              # Frontend: UI, i18n, user interactions
│   ├── index.html          # HTML structure
│   ├── styles.css          # Styling
├── scripts/
│   ├── prefetch-hk-streets.mjs  # Batch prefetch for HK streets
│   ├── hk-streets.json     # Indexed HK street list (cached)
│   ├── setup-cloudflare.ps1     # Cloudflare setup script
│   ├── start-dev.ps1       # Windows dev server launcher
│   ├── stop-dev.ps1        # Windows dev server stopper
├── wrangler.toml           # Cloudflare Workers config
├── tsconfig.json           # TypeScript config
├── package.json            # Dependencies
├── .env.example            # Environment variable template
├── CODEBASE_ANALYSIS.md         # Detailed code audit report
├── API.md                       # Consolidated backend reference (architecture + API + ops)
└── README.md              # This file
```

## 🔧 Configuration

### Environment Variables

Required variables (see `.env.example`):
- `GOOGLE_MAPS_API_KEY` - Google Maps API key (for Street View, Places, Geocoding)
- `GEMINI_API_KEY` - Google Gemini API key (for AI descriptions)

Optional:
- `ALLOWED_ACCESS_EMAILS` - Comma-separated emails for production access control
- `GOOGLE_VISION_API_KEY` - (Legacy, kept for reference)

### Cloudflare Configuration

Edit `wrangler.toml` to configure:
- D1 Database binding: `env.DB (alavia)`
- R2 Bucket binding: `env.CACHE_BUCKET (alavia-cache)`
- Environment variables
- Routes and asset serving

## 📊 Architecture Overview

See [API.md](API.md) for architecture, endpoint contracts, and runbook notes.

**Quick Summary:**
- **Frontend**: Static web app (HTML/JS) with i18n support
- **Backend**: Cloudflare Worker (TypeScript) handling API requests
- **Database**: D1 SQLite for cache metadata and billing tracking
- **Storage**: R2 object storage for cached images and API responses
- **Caching**: 3-layer strategy (Cloudflare edge → D1 index → R2 blobs)

## 🔌 API Endpoints

See [API.md](API.md) for complete endpoint documentation.

**Key endpoints:**
- `POST /api/geocode/autobbox` - Geocode address to bounding box
- `POST /api/overpass/segment` - Get intersections on a road
- `POST /api/paid/streetview` - Get Street View images & AI descriptions (2 headings: left/right)
- `POST /api/paid/places` - Get nearby landmarks from Google Places
- `POST /api/osm/route-places` - Get OSM landmarks between two points
- `POST /api/streetview/metadata` - Check Street View coverage (free)
- `POST /api/admin/cleanup-noimage` - Remove no-coverage cache entries
- `POST /api/admin/streetview-storage` - Query cache statistics

## 💾 Database Schema

### `api_cache` Table
Tracks all cached API responses with 3-layer caching:
- `cache_key` - SHA256 hash of request payload
- `object_key` - R2 object reference
- `provider` - Cache provider type (places, streetview-image-v1, etc.)
- `created_at` - Timestamp
- `bytes` - Size for storage tracking

### `billing_events` Table
Logs API usage for cost estimation:
- `provider` - Service used (places, streetview, etc.)
- `estimated_calls` - Estimated request count
- `billable_calls` - Actual paid calls
- `cache_hits` - Cached responses reused
- `estimated_usd` - Estimated cost
- `actual_usd` - Actual cost charged
- `created_at` - Timestamp

## 💰 Cost Estimation

**Street View Details (2 images + 2 AI descriptions per intersection):**
- Street View Static API: $0.007 per image × 2 = $0.014
- Gemini 3 Flash Lite: ~$0.00005 per call × 2 = ~$0.0001
- **Total estimate**: ~$0.0141 per intersection

**Nearby Places (Google Places):**
- $0.032 per intersection

**OSM Landmarks:**
- Free (uses OpenStreetMap data)

## 🔒 Security Notes

1. **API Key Protection**: Keys in `.dev.vars` (dev) and Cloudflare Secrets (prod)
2. **Access Control**: Optional email-based IP checking via Cloudflare Access
3. **Input Validation**: All coordinates, queries validated before API calls
4. **Error Messages**: User-friendly without leaking internals
5. **Metadata Checks**: Pre-check Street View coverage before expensive API calls

## 🐛 Known Issues & Improvements

See [CODEBASE_ANALYSIS.md](CODEBASE_ANALYSIS.md) for detailed audit with 29 issues identified and recommendations.

**Critical improvements needed:**
- Add request timeout handling for external APIs
- Implement rate limiting and DDoS protection
- Validate coordinate bounds
- Add structured logging for observability
- Simplify triple-layer caching to reduce race conditions

## 📚 Development

### Build
```bash
npm run build
```

### Type Check
```bash
npm run check
```

### Format Code
Use VS Code with TypeScript extension for auto-formatting.

### See Also
- [API.md](API.md) - System design + API reference + ops checks
- [CODEBASE_ANALYSIS.md](CODEBASE_ANALYSIS.md) - Code audit and improvements
- [CONTRIBUTING.md](CONTRIBUTING.md) - Development workflow

## 📞 Support

For issues, suggestions, or contributions, please refer to [CONTRIBUTING.md](CONTRIBUTING.md).

## 📄 License

[Add your license here]

---

**Last Updated:** May 2, 2026  
**Status:** Under active development
