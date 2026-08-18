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
  email: string;
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

export async function getSession(): Promise<SessionPayload | null> {
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
