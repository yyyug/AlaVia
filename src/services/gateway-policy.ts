import {
  RATE_LIMIT_DEFAULT_PER_WINDOW,
  RATE_LIMIT_PAID_PER_WINDOW,
  RATE_LIMIT_WINDOW_SECONDS,
} from "../config/constants";
import { nowEpoch } from "../lib/geo-utils";

type PolicyEnv = {
  ALLOWED_ACCESS_EMAILS?: string;
  DB: D1Database;
};

function getClientIp(request: Request): string {
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

function enforceAllowedAccessEmails(request: Request, env: PolicyEnv): void {
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

export async function enforceRateLimit(
  request: Request,
  env: PolicyEnv,
  scope: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const ip = getClientIp(request);
  if (!ip) {
    return;
  }

  const now = nowEpoch();
  const bucket = Math.floor(now / windowSeconds);
  const expiresAt = (bucket + 1) * windowSeconds + windowSeconds;
  const key = `${scope}:${ip}:${bucket}`;

  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (rate_key, count, expires_at, updated_at)
     VALUES (?1, 1, ?2, ?3)
     ON CONFLICT(rate_key) DO UPDATE SET
       count = count + 1,
       updated_at = excluded.updated_at
     RETURNING count`,
  )
    .bind(key, expiresAt, now)
    .first<{ count: number }>();

  const count = Number(row?.count || 0);
  if (count > limit) {
    throw new Error("Too many requests");
  }

  if (Math.random() < 0.02) {
    await env.DB.prepare("DELETE FROM rate_limits WHERE expires_at < ?1").bind(now).run();
  }
}

export async function enforceGatewayPolicies(
  request: Request,
  env: PolicyEnv,
  path: string,
  ensureSchema: () => Promise<void>,
): Promise<void> {
  const requireAccessIdentity =
    path.startsWith("/api/paid/") ||
    path.startsWith("/api/google/") ||
    path.startsWith("/api/admin/") ||
    path.startsWith("/api/me") ||
    path.startsWith("/api/billing/");

  if (requireAccessIdentity) {
    enforceAllowedAccessEmails(request, env);
  }

  const pathGroup =
    path.startsWith("/api/paid/") || path.startsWith("/api/google/") ? "paid" : "default";
  const perWindow = pathGroup === "paid" ? RATE_LIMIT_PAID_PER_WINDOW : RATE_LIMIT_DEFAULT_PER_WINDOW;

  await ensureSchema();
  await enforceRateLimit(request, env, `ip:${pathGroup}`, perWindow, RATE_LIMIT_WINDOW_SECONDS);
}
