import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { verifyPassword, setSessionCookie } from "@/lib/auth";
import { jsonError, jsonOk, rateLimit } from "@/lib/api";
import { eq } from "drizzle-orm";
import { logAudit } from "@/lib/audit";

const bodySchema = z.object({ email: z.string().email(), password: z.string().min(1) });

// Brute-force protection (audit finding F-2): rate-limited on two axes so
// neither a single IP hammering many accounts, nor many IPs hammering one
// account (e.g. a botnet credential-stuffing attempt), can grind through
// passwords unbounded. Both checks run BEFORE touching the database or
// hashing anything, so a blocked request costs almost nothing to reject.
// Per-account is intentionally tighter than per-IP — the thing actually
// worth protecting is any one person's account, not a shared office IP.
export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");
  const { email, password } = parsed.data;

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  const ipOk = await rateLimit(`login:ip:${ip}`, 20, 5 * 60_000);
  const accountOk = await rateLimit(`login:acct:${email.toLowerCase()}`, 8, 15 * 60_000);
  if (!ipOk || !accountOk) {
    return jsonError("Too many login attempts — please wait a few minutes and try again.", 429, "RATE_LIMITED");
  }

  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  // Deliberately generic error message — never reveal whether the email
  // exists (avoid user enumeration). Same message covers a phone-only or
  // Google/Apple-only account with no password set — telling them
  // specifically "this account has no password" would leak that the
  // email exists, undoing the whole point of the generic message.
  if (!user || !user.active || !user.passwordHash) return jsonError("Invalid email or password", 401);

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) return jsonError("Invalid email or password", 401);

  await setSessionCookie({ userId: user.id, tenantId: user.tenantId, role: user.role, email: user.email, name: user.name });
  await logAudit({ tenantId: user.tenantId, userId: user.id, action: "user.login", entity: "user", entityId: user.id, source: "APP" });

  return jsonOk({ userId: user.id, role: user.role, name: user.name });
}
