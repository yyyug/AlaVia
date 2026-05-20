import { CACHE_MAX_AGE_SECONDS } from "../config/constants";
import { nowEpoch } from "../lib/geo-utils";

type Json = Record<string, unknown>;

type CacheEnv = {
  DB: D1Database;
  CACHE_BUCKET: R2Bucket;
};

function getEdgeCache(): Cache {
  return (caches as CacheStorage & { default: Cache }).default;
}

export async function buildCacheKey(provider: string, payload: Json): Promise<string> {
  const text = `${provider}:${stableStringify(payload)}`;
  const encoded = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
  return `{${parts.join(",")}}`;
}

async function persistCachedValue(
  env: CacheEnv,
  provider: string,
  cacheKey: string,
  payload: Json,
  data: Json,
  expiresAt: number,
  now: number,
): Promise<void> {
  const objectKey = `${provider}/${cacheKey}.json`;
  const cacheMeta = stableStringify(payload);

  await env.CACHE_BUCKET.put(objectKey, JSON.stringify(data), {
    httpMetadata: {
      contentType: "application/json; charset=utf-8",
      cacheControl: `max-age=${CACHE_MAX_AGE_SECONDS}`,
    },
  });

  await env.DB.prepare(
    `INSERT INTO api_cache (cache_key, provider, object_key, expires_at, created_at, last_access_at, cache_meta)
     VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6)
     ON CONFLICT(cache_key) DO UPDATE SET
       provider = excluded.provider,
       object_key = excluded.object_key,
       expires_at = excluded.expires_at,
       last_access_at = excluded.last_access_at,
       cache_meta = excluded.cache_meta`,
  )
    .bind(cacheKey, provider, objectKey, expiresAt, now, cacheMeta)
    .run();
}

async function writeEdgeCache(req: Request, data: Json): Promise<void> {
  const res = new Response(JSON.stringify(data), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${CACHE_MAX_AGE_SECONDS}`,
    },
  });
  await getEdgeCache().put(req, res);
}

export async function getOrCreateCached(
  env: CacheEnv,
  provider: string,
  payload: Json,
  creator: () => Promise<Json>,
  ttlSeconds: number,
  options?: {
    ctx?: ExecutionContext;
    staleWhileRevalidateSeconds?: number;
  },
): Promise<{ data: Json; cacheHit: boolean; stale?: boolean }> {
  const cacheKey = await buildCacheKey(provider, payload);

  const edgeReq = new Request(`https://cache.local/${provider}/${cacheKey}`);
  const edgeHit = await getEdgeCache().match(edgeReq);
  if (edgeHit) {
    const data = (await edgeHit.json()) as Json;
    return { data, cacheHit: true };
  }

  const now = nowEpoch();
  const staleWhileRevalidateSeconds = Math.max(0, Number(options?.staleWhileRevalidateSeconds || 0));
  const row = await env.DB.prepare(
    "SELECT object_key, expires_at FROM api_cache WHERE cache_key = ?1 AND provider = ?2 LIMIT 1",
  )
    .bind(cacheKey, provider)
    .first<{ object_key: string; expires_at: number }>();

  if (row) {
    const obj = await env.CACHE_BUCKET.get(row.object_key);
    if (obj) {
      const data = (await obj.json()) as Json;
      await env.DB.prepare("UPDATE api_cache SET last_access_at = ?1 WHERE cache_key = ?2").bind(now, cacheKey).run();
      await writeEdgeCache(edgeReq, data);

      if (row.expires_at > now) {
        return { data, cacheHit: true };
      }

      const staleFor = now - row.expires_at;
      if (staleFor <= staleWhileRevalidateSeconds) {
        if (options?.ctx) {
          options.ctx.waitUntil(
            (async () => {
              const fresh = await creator();
              await persistCachedValue(env, provider, cacheKey, payload, fresh, nowEpoch() + ttlSeconds, nowEpoch());
              await writeEdgeCache(edgeReq, fresh);
            })(),
          );
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

export async function recordBilling(
  env: CacheEnv,
  args: { provider: string; cacheHit: number; estimatedUsd: number; actualUsd: number; userId?: string },
): Promise<void> {
  const userId = args.userId || "anonymous";
  await env.DB.prepare(
    "INSERT INTO billing_events (user_id, provider, cache_hit, estimated_usd, actual_usd, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
  )
    .bind(userId, args.provider, args.cacheHit, args.estimatedUsd, args.actualUsd, nowEpoch())
    .run();
}
