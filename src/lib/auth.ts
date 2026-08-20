import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import type { Role } from "@/db/schema";

const SESSION_COOKIE = "ara_session";

export interface SessionPayload {
  userId: string;
  tenantId: string;
  role: Role;
  // Nullable — a phone-only or Google/Apple-only account may have no
  // password-auth email (see users.email in schema.ts).
  email: string | null;
  name: string;
}

function getJwtSecret(): string {
  return process.env.JWT_SECRET || "dev-insecure-secret-change-me";
}

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: "7d" });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, getJwtSecret()) as SessionPayload;
  } catch {
    return null;
  }
}

// --- Dev-only login bypass -------------------------------------------------
// For local demos where clicking through /login every time is friction.
// Two independent gates, both must hold: DISABLE_AUTH must be the literal
// string "true" in .env, AND NODE_ENV must not be "production" — the second
// gate is defense in depth so this can never activate in a real deployment
// even if DISABLE_AUTH="true" is left in a prod .env by mistake (Next.js
// sets NODE_ENV="production" for `npm run build`/`npm start` regardless of
// what's in .env). Off by default. Single chokepoint: every internal route
// and the app layout goes through getSession(), so this is the only place
// that needs to know about it. See BUILD_NOTES.md → "Dev-only login bypass".
function isAuthBypassEnabled(): boolean {
  return process.env.DISABLE_AUTH === "true" && process.env.NODE_ENV !== "production";
}

let bypassWarningLogged = false;

async function getBypassSession(): Promise<SessionPayload | null> {
  if (!bypassWarningLogged) {
    // eslint-disable-next-line no-console
    console.warn(
      "\n[auth] ⚠️  DISABLE_AUTH=true — login is BYPASSED for every request. " +
        "Dev-only. Remove DISABLE_AUTH from .env to restore normal login.\n"
    );
    bypassWarningLogged = true;
  }

  const email = process.env.DISABLE_AUTH_EMAIL || "owner@raygrid.demo";
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);

  // Falls through to null (real login required) rather than fabricating a
  // session if the target user doesn't exist — never fake an authenticated
  // identity that isn't backed by a real row.
  if (!user || !user.active) return null;

  return {
    userId: user.id,
    tenantId: user.tenantId,
    role: user.role,
    email: user.email,
    name: user.name,
  };
}

export async function getSession(): Promise<SessionPayload | null> {
  if (isAuthBypassEnabled()) {
    return getBypassSession();
  }
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

export async function setSessionCookie(payload: SessionPayload) {
  const store = await cookies();
  store.set(SESSION_COOKIE, signSession(payload), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) {
    throw new Error("UNAUTHENTICATED");
  }
  // Defense in depth: re-validate the user still exists & is active &
  // belongs to the claimed tenant, in case the JWT was issued for a user
  // later deactivated (section 34: server-side authorization).
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, session.userId))
    .limit(1);
  if (!user || !user.active || user.tenantId !== session.tenantId) {
    throw new Error("UNAUTHENTICATED");
  }
  return session;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
