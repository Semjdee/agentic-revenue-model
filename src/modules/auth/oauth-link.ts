import { db, schema } from "@/db/client";
import { generateId } from "@/lib/ids";
import { and, eq } from "drizzle-orm";
import { provisionTenant } from "./provision";
import type { Role } from "@/db/schema";

// Shared "who does this Google/Apple identity belong to" resolution —
// used by both the Google and Apple callback routes so account-linking
// (and its edge cases) is defined once, not per provider.
export interface OAuthProfile {
  provider: (typeof schema.AUTH_IDENTITY_PROVIDERS)[number];
  providerUserId: string; // the provider's stable "sub" claim
  email: string | null;
  name: string | null;
}

export interface ResolvedOAuthUser {
  userId: string;
  tenantId: string;
  role: Role;
  email: string | null;
  name: string;
  isNewAccount: boolean;
}

export class AmbiguousOAuthEmailError extends Error {
  constructor() {
    super("More than one account already uses this email address — sign in with a password instead.");
  }
}

export async function resolveOAuthUser(profile: OAuthProfile): Promise<ResolvedOAuthUser> {
  // 1. Already linked — the common case for a returning user.
  const [linked] = await db
    .select()
    .from(schema.authIdentities)
    .where(and(eq(schema.authIdentities.provider, profile.provider), eq(schema.authIdentities.providerUserId, profile.providerUserId)))
    .limit(1);
  if (linked) {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, linked.userId)).limit(1);
    if (user && user.active) {
      return { userId: user.id, tenantId: user.tenantId, role: user.role, email: user.email, name: user.name, isNewAccount: false };
    }
  }

  // 2. Not linked yet, but an existing account uses this email (e.g. they
  // originally signed up with a password) — link this identity to it
  // rather than creating a duplicate tenant. Email is only unique
  // per-tenant in this schema (see db/schema.ts's note on users.email),
  // so more than one match is a real possibility this has to handle
  // explicitly rather than silently picking one.
  if (profile.email) {
    const matches = await db.select().from(schema.users).where(eq(schema.users.email, profile.email)).limit(2);
    if (matches.length > 1) throw new AmbiguousOAuthEmailError();
    if (matches.length === 1 && matches[0].active) {
      const user = matches[0];
      await db.insert(schema.authIdentities).values({ id: generateId(), userId: user.id, provider: profile.provider, providerUserId: profile.providerUserId, email: profile.email });
      return { userId: user.id, tenantId: user.tenantId, role: user.role, email: user.email, name: user.name, isNewAccount: false };
    }
  }

  // 3. Genuinely new — provision a fresh tenant, same as any other
  // self-service signup path.
  const ownerName = profile.name || (profile.email ? profile.email.split("@")[0] : "New user");
  const companyName = profile.email ? `${profile.email.split("@")[0]}'s Workspace` : `${ownerName}'s Workspace`;
  const { tenantId, userId } = await provisionTenant({ companyName, ownerName, email: profile.email });
  await db.insert(schema.authIdentities).values({ id: generateId(), userId, provider: profile.provider, providerUserId: profile.providerUserId, email: profile.email });
  return { userId, tenantId, role: "OWNER", email: profile.email, name: ownerName, isNewAccount: true };
}
