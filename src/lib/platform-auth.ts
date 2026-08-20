import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";

// Platform-staff session handling — intentionally a separate module from
// src/lib/auth.ts (tenant sessions), not a variant of it. Different
// cookie name, different payload shape (no tenantId field at all — a
// platform-staff JWT structurally cannot be mistaken for a tenant
// session, and vice versa), and its own signing secret so a leaked
// tenant JWT_SECRET can't be used to forge a platform session either.
// getSession() (tenant) and getPlatformSession() (this file) are never
// called from the same route — every route under
// src/app/api/internal/** and src/app/(app)/** uses the former, every
// route under src/app/api/platform/** and src/app/platform/** uses the
// latter, and neither checks the other's cookie.

const PLATFORM_SESSION_COOKIE = "ara_platform_session";

export interface PlatformSessionPayload {
  staffId: string;
  role: (typeof schema.PLATFORM_ROLES)[number];
  email: string;
  name: string;
}

function getPlatformJwtSecret(): string {
  // Falls back to a value that deliberately differs from the tenant
  // secret's own dev fallback ("dev-insecure-secret-change-me" in
  // lib/auth.ts) — even in local dev without either env var set, the two
  // token spaces don't overlap.
  return process.env.PLATFORM_JWT_SECRET || "dev-insecure-platform-secret-change-me";
}

export function signPlatformSession(payload: PlatformSessionPayload): string {
  return jwt.sign(payload, getPlatformJwtSecret(), { expiresIn: "12h" });
}

export function verifyPlatformSession(token: string): PlatformSessionPayload | null {
  try {
    return jwt.verify(token, getPlatformJwtSecret()) as PlatformSessionPayload;
  } catch {
    return null;
  }
}

export async function getPlatformSession(): Promise<PlatformSessionPayload | null> {
  const store = await cookies();
  const token = store.get(PLATFORM_SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifyPlatformSession(token);
}

export async function setPlatformSessionCookie(payload: PlatformSessionPayload) {
  const store = await cookies();
  store.set(PLATFORM_SESSION_COOKIE, signPlatformSession(payload), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    // Shorter-lived than a tenant session (7d) — this is an internal
    // operator surface with cross-tenant reach, worth re-authenticating
    // more often.
    maxAge: 60 * 60 * 12,
  });
}

export async function clearPlatformSessionCookie() {
  const store = await cookies();
  store.delete(PLATFORM_SESSION_COOKIE);
}

export async function requirePlatformSession(): Promise<PlatformSessionPayload> {
  const session = await getPlatformSession();
  if (!session) throw new Error("UNAUTHENTICATED");
  // Defense in depth, same discipline as requireSession() for tenants —
  // re-validate the staff account still exists and is active, in case it
  // was deactivated after the JWT was issued.
  const [staff] = await db.select().from(schema.platformStaff).where(eq(schema.platformStaff.id, session.staffId)).limit(1);
  if (!staff || !staff.active) throw new Error("UNAUTHENTICATED");
  return session;
}
