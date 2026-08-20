import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { jsonError, jsonOk, rateLimit } from "@/lib/api";
import { requestOtp } from "@/modules/auth/otp";

const bodySchema = z.object({
  // E.164-ish: + followed by 8-15 digits. Real validation/formatting of
  // phone numbers is a whole library on its own (libphonenumber) — this
  // is a pragmatic minimum, not a claim of full international coverage.
  phone: z.string().regex(/^\+[1-9]\d{7,14}$/, "Enter your phone number in international format, e.g. +256700123456"),
  purpose: z.enum(schema.OTP_PURPOSES),
});

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || "Invalid input", 422, "VALIDATION_ERROR");
  const { phone, purpose } = parsed.data;

  // Per-phone AND per-IP — prevents both SMS-bombing one number and one
  // client burning through many numbers.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  const phoneOk = await rateLimit(`otp:phone:${phone}`, 3, 10 * 60_000);
  const ipOk = await rateLimit(`otp:ip:${ip}`, 10, 10 * 60_000);
  if (!phoneOk || !ipOk) return jsonError("Too many codes requested — please wait a few minutes and try again.", 429, "RATE_LIMITED");

  if (purpose === "SIGNUP") {
    const [existing] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.phone, phone)).limit(1);
    if (existing) return jsonError("An account with this phone number already exists — try logging in instead.", 409);
  }

  const result = await requestOtp(phone, purpose);
  if (!result.ok) return jsonError(result.detail || "Couldn't send the verification code — please try again.", 502);

  // mockCode is only ever present when no real SMS provider is configured
  // (modules/sms/sender.ts) — never sent alongside a genuine delivery.
  return jsonOk({ sent: true, isMock: result.isMock, mockCode: result.mockCode });
}
