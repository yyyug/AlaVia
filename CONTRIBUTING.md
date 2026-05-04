# Contributing to AlaVia

Thank you for your interest in contributing to AlaVia! This document provides guidelines for development, code style, and contribution workflows.

## Getting Started

### Prerequisites
- Node.js 18+
- npm or yarn
- Wrangler CLI (`npm install -g wrangler`)
- Git

### Development Setup

1. **Clone and install**:
   ```bash
   git clone <repository>
   cd AlaVia
   npm install
   ```

2. **Set up environment variables**:
   ```bash
   cp .env.example .dev.vars
   # Edit .dev.vars with your API keys
   ```

3. **Start development server**:
   ```bash
   npm run dev
   ```
   Open `http://127.0.0.1:8787` in your browser.

4. **Run type checks**:
   ```bash
   npm run check
   ```

## Development Workflow

### Making Changes

1. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make changes** following code style guidelines (see below)

3. **Test locally**:
   ```bash
   npm run dev
   # Test in browser or via API calls
   ```

4. **Type check**:
   ```bash
   npm run check
   ```

5. **Commit with descriptive message**:
   ```bash
   git add .
   git commit -m "feat: add new feature description"
   ```

6. **Push and create pull request**:
   ```bash
   git push origin feature/your-feature-name
   ```

### Code Style

#### TypeScript/JavaScript

- **Formatter**: Prettier (configured in VS Code)
- **Linter**: TypeScript strict mode enabled
- **Naming Conventions**:
  - Functions: `camelCase` (e.g., `handlePaidStreetView`)
  - Classes: `PascalCase` (e.g., `CacheManager`)
  - Constants: `SCREAMING_SNAKE_CASE` (e.g., `OVERPASS_TIMEOUT_MS`)
  - Private methods: `_prefix` (e.g., `_sanitizeInput`)
  - Files: `kebab-case.ts` or `camelCase.mjs`

- **Type Safety**:
  ```typescript
  // ✅ Good: explicit types
  function fetchData(url: string, timeout: number): Promise<Json> {
    // ...
  }
  
  // ❌ Avoid: implicit any
  function fetchData(url, timeout) {
    // ...
  }
  ```

- **Error Handling**:
  ```typescript
  // ✅ Good: explicit error handling
  try {
    const result = await fetchApi(url);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("API call failed:", message);
    throw new Error(`Failed to fetch: ${message}`);
  }
  
  // ❌ Avoid: silent failures
  try {
    return await fetchApi(url);
  } catch {
    // silently fail
  }
  ```

#### HTML/CSS

- **HTML**: Semantic markup, ARIA labels for accessibility
- **CSS**: Utility-first (no framework), mobile-first responsive design
- **Variable Names**: Semantic (e.g., `--color-text-primary` not `--color-dark`)

### Testing

#### Manual Testing Checklist

- [ ] Frontend loads without errors
- [ ] All language options display correctly (zh-Hant, en, ja, ko)
- [ ] Search works with various address formats
- [ ] Navigation buttons function correctly
- [ ] Cost estimates display accurately
- [ ] Cache hits are tracked
- [ ] No console errors

#### Testing API Endpoints

```bash
# Geocoding
curl -X POST http://127.0.0.1:8787/api/geocode/autobbox \
  -H "Content-Type: application/json" \
  -d '{"query": "Central Hong Kong", "countryCode": "HK"}'

# Street View Metadata
curl -X POST http://127.0.0.1:8787/api/streetview/metadata \
  -H "Content-Type: application/json" \
  -d '{"lat": 22.2869, "lon": 114.1456}'

# Storage Report
curl -X POST http://127.0.0.1:8787/api/admin/streetview-storage \
  -H "Content-Type: application/json" \
  -d '{}'
```

#### Batch Testing

```bash
# Prefetch single street for testing
npm run prefetch:hk -- --from 1 --to 1

# Prefetch with custom language
npm run prefetch:hk -- --from 1 --to 10 --language en
```

## Project Structure Guidelines

### Adding a New API Endpoint

1. **Add route handler in `src/worker.ts`**:
   ```typescript
   if (url.pathname === "/api/myfeature/endpoint" && request.method === "POST") {
     return withErrorHandling(() => handleMyFeature(request, env, ctx));
   }
   ```

2. **Implement handler function**:
   ```typescript
   async function handleMyFeature(
     request: Request, 
     env: Env, 
     ctx: ExecutionContext
   ): Promise<Response> {
     requireAllowedUser(request, env);
     await ensureD1Schema(env);
     const body = await requireJson(request);
     
     // Validate input
     const lat = Number(body.lat);
     const lon = Number(body.lon);
     if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
       throw new Error("lat and lon must be valid numbers");
     }
     
     // Process with caching
     const cached = await getOrCreateCached(env, "provider-name", payload, async () => {
       // Implement fetching logic
       return result;
     }, TTL_DAYS);
     
     // Record billing if applicable
     await recordBilling(env, { provider: "my-feature", billableCalls: 1 });
     
     return json({ ok: true, data: cached.data });
   }
   ```

3. **Add to frontend in `public/app.js`** if user-facing

4. **Document in `API.md`** with request/response examples

### Adding Frontend Features

1. **Add i18n strings in `public/app.js`**:
   ```javascript
   const I18N = {
     "zh-Hant": {
       myFeature: "我的功能",
       myFeatureDesc: "功能描述",
     },
     en: {
       myFeature: "My Feature",
       myFeatureDesc: "Feature description",
     },
     // Add ja and ko as well
   };
   ```

2. **Add HTML element** (if needed):
   ```html
   <section id="myFeatureSection">
     <h2></h2>  <!-- Populated by JS -->
     <!-- content -->
   </section>
   ```

3. **Add JavaScript handler**:
   ```javascript
   async function handleMyFeature() {
     const result = await postJson("/api/myfeature/endpoint", {
       // parameters
     });
     // Update UI with result
   }
   ```

## Performance Guidelines

### Caching Strategy

- **Cache Time (TTL)**:
  - Geographic data (streets, intersections): **365 days** (`TTL_365_DAYS`)
  - Dynamic data (addresses, places): **30 days** (`OSM_CACHE_STALE_SECONDS`)
  - Real-time data: **No cache** or short TTL

- **Cache Keys**: Generated using SHA256 hash of provider + payload
  - Same input = same cache key (deterministic)
  - Prevents duplicate API calls

### API Call Optimization

- **Batch operations** using `Promise.all()`:
  ```typescript
  const results = await Promise.all([
    fetchGooglePlaces(...),
    fetchOverpassData(...),
    fetchStreetViewMetadata(...)
  ]);
  ```

- **Metadata pre-checks** before expensive calls:
  ```typescript
  const metaStatus = await fetchStreetViewMetadata(mapsKey, lat, lon);
  if (metaStatus === "OK") {
    // Only then fetch the expensive image
    const image = await fetchImageBytes(imageUrl);
  }
  ```

- **Coordinate rounding** for cache hit consistency:
  ```typescript
  const roundedLat = round6(lat);  // 6 decimal places (~0.1 meter precision)
  ```

## Deployment

### To Production

1. **Build and test locally**:
   ```bash
   npm run build
   npm run check
   npm run dev
   ```

2. **Deploy to Cloudflare**:
   ```bash
   wrangler deploy --env production
   ```

3. **Verify deployment**:
   ```bash
   curl https://alavia.example.com/
   ```

### Environment-Specific Configuration

Edit `wrangler.toml`:
```toml
[env.production]
route = "example.com/*"

[env.production.vars]
ALLOWED_ACCESS_EMAILS = "user@example.com"

[[env.production.kv_namespaces]]
binding = "CACHE"
id = "production_cache_id"
```

## Documentation

### Updating Docs

When making changes that affect users or architecture:

1. **Update API.md** if adding/modifying endpoints
2. **Update README.md** if changing setup or features
3. **Update ARCHITECTURE.md** if changing system design
4. **Update CODEBASE_ANALYSIS.md** if fixing issues

### Code Comments

Write clear, concise comments:

```typescript
// ✅ Good: explains WHY
// Pre-check metadata to avoid fetching images for areas without coverage
// This reduces API costs by ~70% in some regions
const metaStatus = await fetchStreetViewMetadata(...);

// ❌ Avoid: restates code
// Check the metadata status
const metaStatus = await fetchStreetViewMetadata(...);
```

## Common Issues & Troubleshooting

### "GOOGLE_MAPS_API_KEY is not configured"
- Copy `.env.example` to `.dev.vars`
- Add your actual API key
- Restart dev server

### Prefetch script fails with "No Hong Kong streets found"
- Ensure dev server is running: `npm run dev`
- Check API base URL: `--baseUrl http://127.0.0.1:8787`
- Try refreshing street list: `--refreshStreetList true`

### Type errors with "unknown"
- Add proper type annotations
- Use `as Json` for untyped API responses
- Check TypeScript strict mode is enabled

### Cache not working
- Verify D1 schema is created: `await ensureD1Schema(env)`
- Check R2 bucket bindings in `wrangler.toml`
- Manually clean cache: `POST /api/admin/cleanup-noimage`

## Code Review Process

1. **Self-review** before pushing:
   - Run type check: `npm run check`
   - Test locally: `npm run dev`
   - Review your own code for style/errors

2. **Peer review**:
   - At least one approval required
   - Reviewers check: functionality, style, performance, documentation

3. **Merge to main**:
   - Squash commits if multiple small commits
   - Use clear commit message
   - Delete feature branch

## Performance & Best Practices Review

See [CODEBASE_ANALYSIS.md](CODEBASE_ANALYSIS.md) for detailed best practices and known issues.

### Critical Issues to Avoid

- ❌ Silent error handling (always throw or handle explicitly)
- ❌ N+1 queries (batch requests together)
- ❌ Missing type annotations (use strict TypeScript)
- ❌ Hardcoded numbers (extract to named constants)
- ❌ No timeout handling (set reasonable timeouts)

## Questions?

- Check [ARCHITECTURE.md](ARCHITECTURE.md) for system overview
- Check [API.md](API.md) for endpoint details
- Check [CODEBASE_ANALYSIS.md](CODEBASE_ANALYSIS.md) for technical issues
- Review existing code for patterns

---

**Last Updated**: May 2, 2026
