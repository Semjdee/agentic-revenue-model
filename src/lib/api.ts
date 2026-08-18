import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq, and, isNull } from "drizzle-orm";
import { hashApiKeySecret } from "@/lib/crypto";
import { redisConnection } from "@/modules/followups/queue";

export function jsonError(message: string, status = 400, code?: string) {
  return NextResponse.json({ error: { message, code: code ?? status } }, { status });
}

export function jsonOk<T>(data: T, status = 200) {
  return NextResponse.json({ data }, { status });
}

/** Session-based auth guard for internal back-office API routes. */
export async function requireTenantSession() {
  const session = await getSession();
  if (!session) return null;
  return session;
}

/**
 * API-key auth guard for the public /api/v1/* gateway (section 19).
 * Expects `Authorization: Bearer ark_xxx.secret`.
 */
export async function requireApiKey(req: Request): Promise<{ tenantId: string; apiKeyId: string } | null> {
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token || !token.includes(".")) return null;
  const [prefix, secret] = token.split(".");
  const hashed = hashApiKeySecret(secret);

  const [key] = await db
    .select()
    .from(schema.apiKeys)
    .where(and(eq(schema.apiKeys.prefix, prefix), isNull(schema.apiKeys.revokedAt)))
    .limit(1);

  if (!key || key.hashedKey !== hashed) return null;

  await db
    .update(schema.apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(schema.apiKeys.id, key.id));

  return { tenantId: key.tenantId, apiKeyId: key.id };
}

// Redis-backed fixed-window rate limiter, shared across every app instance
// (reuses the same ioredis connection BullMQ already holds open for the
// follow-up queue — no new infra). Previously this was a plain in-memory
// Map, which only limited requests within a single Node process: with more
// than one instance behind a load balancer, a client could get `limit *
// instanceCount` requests through per window because each process counted
// independently. INCR+PEXPIRE runs atomically via a Lua script so concurrent
// requests across instances still share one accurate counter.
//
// Fails OPEN (allows the request) if Redis is unreachable, logging a
// warning — an availability outage in the rate limiter should not turn into
// an outage of the API itself. This is a fixed-window limiter (not sliding
// window/token-bucket), which can allow a short burst right at a window
// boundary; acceptable for this MVP's traffic levels, revisit with
// `rate-limiter-flexible` if that burst tolerance becomes a problem.
const RATE_LIMIT_SCRIPT = `
local current = redis.call("INCR", KEYS[1])
if tonumber(current) == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
return current
`;

export async function rateLimit(key: string, limit = 60, windowMs = 60_000): Promise<boolean> {
  try {
    const count = (await redisConnection.eval(RATE_LIMIT_SCRIPT, 1, `ratelimit:${key}`, windowMs)) as number;
    return count <= limit;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[rateLimit] Redis unavailable, failing open:", (err as Error).message);
    return true;
  }
}
