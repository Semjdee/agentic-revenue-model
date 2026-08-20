import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { verifyPassword } from "@/lib/auth";
import { setPlatformSessionCookie } from "@/lib/platform-auth";
import { jsonError, jsonOk, rateLimit } from "@/lib/api";

const bodySchema = z.object({ email: z.string().email(), password: z.string().min(1) });

// Same brute-force protections as the tenant login route
// (src/app/api/internal/auth/login/route.ts) — if anything this endpoint
// deserves them more, since a compromised platform-staff account reaches
// every tenant's data.
export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");
  const { email, password } = parsed.data;

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  const ipOk = await rateLimit(`platform-login:ip:${ip}`, 20, 5 * 60_000);
  const accountOk = await rateLimit(`platform-login:acct:${email.toLowerCase()}`, 8, 15 * 60_000);
  if (!ipOk || !accountOk) return jsonError("Too many login attempts — please wait a few minutes and try again.", 429, "RATE_LIMITED");

  const [staff] = await db.select().from(schema.platformStaff).where(eq(schema.platformStaff.email, email)).limit(1);
  if (!staff || !staff.active) return jsonError("Invalid email or password", 401);

  const valid = await verifyPassword(password, staff.passwordHash);
  if (!valid) return jsonError("Invalid email or password", 401);

  await setPlatformSessionCookie({ staffId: staff.id, role: staff.role, email: staff.email, name: staff.name });
  return jsonOk({ staffId: staff.id, role: staff.role, name: staff.name });
}
