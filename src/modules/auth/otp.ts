import { db, schema } from "@/db/client";
import { generateId } from "@/lib/ids";
import { and, desc, eq } from "drizzle-orm";
import { createHash, randomInt } from "crypto";
import { getSmsSender } from "@/modules/sms/sender";

// Real, backend-enforced OTP mechanics — generation, hashing, a short
// expiry, single-use, and a capped number of verification attempts —
// independent of whether the SMS itself is actually delivered or mocked
// (modules/sms/sender.ts). A 6-digit code is genuinely only good for one
// successful verification within 10 minutes and 5 tries.
const CODE_LENGTH = 6;
const EXPIRY_MINUTES = 10;
const MAX_ATTEMPTS = 5;

function hashCode(phone: string, code: string): string {
  // Not a password — a short-lived, single-use numeric code — so a fast
  // hash keyed with the phone number as salt is appropriate (matches this
  // codebase's existing hashApiKeySecret() pattern in lib/crypto.ts rather
  // than reaching for bcrypt here).
  return createHash("sha256").update(`${phone}:${code}:${process.env.JWT_SECRET || "dev-insecure-secret-change-me"}`).digest("hex");
}

function generateCode(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
}

export interface RequestOtpResult {
  ok: boolean;
  isMock: boolean;
  mockCode?: string;
  detail?: string;
}

export async function requestOtp(phone: string, purpose: (typeof schema.OTP_PURPOSES)[number]): Promise<RequestOtpResult> {
  const code = generateCode();
  const expiresAt = new Date(Date.now() + EXPIRY_MINUTES * 60_000);

  await db.insert(schema.otpCodes).values({
    id: generateId(),
    phone,
    codeHash: hashCode(phone, code),
    purpose,
    expiresAt,
  });

  const sender = getSmsSender();
  const result = await sender.send(phone, `Your AI Revenue Agent verification code is ${code}. It expires in ${EXPIRY_MINUTES} minutes.`, code);
  return { ok: result.ok, isMock: result.isMock, mockCode: result.mockCode, detail: result.detail };
}

export type VerifyOtpFailureReason = "NOT_FOUND" | "EXPIRED" | "TOO_MANY_ATTEMPTS" | "INCORRECT_CODE";

export async function verifyOtp(phone: string, purpose: (typeof schema.OTP_PURPOSES)[number], code: string): Promise<{ ok: true } | { ok: false; reason: VerifyOtpFailureReason }> {
  const [row] = await db
    .select()
    .from(schema.otpCodes)
    .where(and(eq(schema.otpCodes.phone, phone), eq(schema.otpCodes.purpose, purpose)))
    .orderBy(desc(schema.otpCodes.createdAt))
    .limit(1);

  if (!row || row.consumedAt) return { ok: false, reason: "NOT_FOUND" };
  if (row.expiresAt.getTime() < Date.now()) return { ok: false, reason: "EXPIRED" };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, reason: "TOO_MANY_ATTEMPTS" };

  if (hashCode(phone, code) !== row.codeHash) {
    await db.update(schema.otpCodes).set({ attempts: row.attempts + 1 }).where(eq(schema.otpCodes.id, row.id));
    return { ok: false, reason: "INCORRECT_CODE" };
  }

  await db.update(schema.otpCodes).set({ consumedAt: new Date() }).where(eq(schema.otpCodes.id, row.id));
  return { ok: true };
}
