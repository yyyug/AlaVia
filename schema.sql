CREATE TABLE IF NOT EXISTS api_cache (
  cache_key TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  object_key TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_access_at INTEGER NOT NULL,
  cache_meta TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_cache_provider_expires
ON api_cache(provider, expires_at);

CREATE TABLE IF NOT EXISTS billing_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  provider TEXT NOT NULL,
  cache_hit INTEGER NOT NULL,
  estimated_usd REAL NOT NULL,
  actual_usd REAL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  rate_key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_expires
ON rate_limits(expires_at);

CREATE TABLE IF NOT EXISTS tile_access (
  tile_key TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  cached_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_tile_access_cached_hits
ON tile_access(cached_at, hits);
