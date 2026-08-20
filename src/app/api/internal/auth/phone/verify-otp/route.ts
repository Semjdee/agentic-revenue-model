import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { setSessionCookie } from "@/lib/auth";
import { jsonError, jsonOk, rateLimit } from "@/lib/api";
import { verifyOtp } from "@/modules/auth/otp";
import { provisionTenant } from "@/modules/auth/provision";
import { logAudit } from "@/lib/audit";

const baseSchema = z.object({
  phone: z.string().regex(/^\+[1-9]\d{7,14}$/),
  code: z.string().length(6),
  purpose: z.enum(schema.OTP_PURPOSES),
});
// SIGNUP additionally needs who's signing up — LOGIN only needs the code,
// since the account (and its name) already exists.
const signupExtra = z.object({ companyName: z.string().min(2), name: z.string().min(1) });

const FAILURE_MESSAGES: Record<string, string> = {
  NOT_FOUND: "No verification code was requested for this number — request a new one.",
  EXPIRED: "That code has expired — request a new one.",
  TOO_MANY_ATTEMPTS: "Too many incorrect attempts — request a new code.",
  INCORRECT_CODE: "That code isn't right — please check and try again.",
};

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = baseSchema.safeParse(body);
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");
  const { phone, code, purpose } = parsed.data;

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  if (!(await rateLimit(`otp-verify:ip:${ip}`, 20, 10 * 60_000))) return jsonError("Too many attempts — please wait a few minutes.", 429, "RATE_LIMITED");

  const result = await verifyOtp(phone, purpose, code);
  if (!result.ok) return jsonError(FAILURE_MESSAGES[result.reason], 401, result.reason);

  if (purpose === "LOGIN") {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.phone, phone)).limit(1);
    if (!user || !user.active) return jsonError("No account found for this phone number — sign up instead.", 404);
    await setSessionCookie({ userId: user.id, tenantId: user.tenantId, role: user.role, email: user.email, name: user.name });
    await logAudit({ tenantId: user.tenantId, userId: user.id, action: "user.login", entity: "user", entityId: user.id, source: "APP" });
    return jsonOk({ userId: user.id, role: user.role, name: user.name });
  }

  // SIGNUP — code is verified; now actually create the account. Re-check
  // for a race (two signup attempts with the same phone landing between
  // send-otp's own check and here) rather than trusting that earlier check.
  const extra = signupExtra.safeParse(body);
  if (!extra.success) return jsonError("Company name and your name are required to finish signing up.", 422, "VALIDATION_ERROR");

  const [existing] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.phone, phone)).limit(1);
  if (existing) return jsonError("An account with this phone number already exists — try logging in instead.", 409);

  const { tenantId, userId } = await provisionTenant({
    companyName: extra.data.companyName,
    ownerName: extra.data.name,
    phone,
    phoneVerifiedAt: new Date(),
  });

  await setSessionCookie({ userId, tenantId, role: "OWNER", email: null, name: extra.data.name });
  return jsonOk({ tenantId, userId });
}
