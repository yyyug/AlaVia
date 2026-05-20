export const DAY = 60 * 60 * 24;
export const TTL_365_DAYS = 365 * DAY;
export const CACHE_MAX_AGE_SECONDS = DAY;
export const GEOCODE_TTL_SECONDS = 30 * DAY;
export const OSM_CACHE_TTL_SECONDS = TTL_365_DAYS;
export const OSM_CACHE_STALE_SECONDS = 30 * DAY;
export const TILE_HOT_CACHE_THRESHOLD = 3;
export const TILE_HOT_CACHE_TTL_SECONDS = 30 * DAY;
export const SOUNDSCAPE_TILE_MAX_AGE_SECONDS = 7 * DAY;
export const SOUNDSCAPE_HK_PMTILES_KEY = "pmtiles/hongkong-z16.pmtiles";
export const OVERPASS_TIMEOUT_MS = 30000;
export const OVERPASS_PLACE_TIMEOUT_MS = 15000;
export const OVERPASS_MAX_ITERATIONS = 2;
export const OVERPASS_MIN_GROWTH_RATIO = 0.05;
export const CLERK_DOMAIN = "possible-skink-4.clerk.accounts.dev";
export const CLERK_ISSUER = `https://${CLERK_DOMAIN}`;
export const EXTERNAL_API_TIMEOUT_MS = 10000;
export const MAX_PAID_INTERSECTIONS = 50;
export const MAX_REQUEST_BODY_BYTES = 100_000;
export const WEBHOOK_MAX_SKEW_SECONDS = 300;
export const RATE_LIMIT_WINDOW_SECONDS = 60;
export const RATE_LIMIT_DEFAULT_PER_WINDOW = 120;
export const RATE_LIMIT_PAID_PER_WINDOW = 30;
export const BUILTIN_ADMIN_EMAILS = new Set(["yoofun@gmail.com"]);

export const PRICES = {
  placesNearby: 0.005,
  streetViewStatic: 0.007,
  geminiGenerate: 0.0003,
};
