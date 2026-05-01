CREATE TABLE IF NOT EXISTS api_cache (
  cache_key TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  object_key TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_access_at INTEGER NOT NULL
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
