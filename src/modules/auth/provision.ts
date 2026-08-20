import { db, schema } from "@/db/client";
import { generateId } from "@/lib/ids";
import { logAudit } from "@/lib/audit";
import { initOnboardingProgress, advanceOnboardingStep, logOnboardingEvent } from "@/modules/onboarding/service";
import { grantCredits } from "@/modules/billing/ledger";
import { FREE_TIER_GRANT_CREDITS } from "@/modules/billing/pricing";

// Bootstraps a brand-new Tenant + Workspace + OWNER user — shared by every
// self-service signup path (password/email, phone+SMS OTP, Google, Apple)
// so "what happens when a new business signs up" is defined exactly once,
// not re-implemented per auth method. The original register route
// (src/app/api/internal/auth/register/route.ts) now calls this too.
export interface ProvisionTenantParams {
  companyName: string;
  ownerName: string;
  email?: string | null;
  passwordHash?: string | null;
  phone?: string | null;
  phoneVerifiedAt?: Date | null;
}

export async function provisionTenant(params: ProvisionTenantParams): Promise<{ tenantId: string; userId: string }> {
  const tenantId = generateId();
  const slug =
    params.companyName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 40) +
    "-" +
    tenantId.slice(0, 6);
  await db.insert(schema.tenants).values({ id: tenantId, name: params.companyName, slug });

  const workspaceId = generateId();
  await db.insert(schema.workspaces).values({ id: workspaceId, tenantId, name: "Default Workspace" });

  const userId = generateId();
  await db.insert(schema.users).values({
    id: userId,
    tenantId,
    workspaceId,
    email: params.email ?? null,
    passwordHash: params.passwordHash ?? null,
    phone: params.phone ?? null,
    phoneVerifiedAt: params.phoneVerifiedAt ?? null,
    name: params.ownerName,
    role: "OWNER",
  });

  await logAudit({ tenantId, userId, action: "tenant.created", entity: "tenant", entityId: tenantId, source: "APP" });

  // Free-tier credit grant — every new tenant starts with a real, metered
  // balance, not unlimited AI usage.
  await grantCredits(tenantId, FREE_TIER_GRANT_CREDITS, "GRANT", "free_tier_signup");

  // Zero-to-live self-onboarding — every fresh signup gets a progress row
  // + funnel events immediately, regardless of which auth method created it.
  await initOnboardingProgress(tenantId);
  await logOnboardingEvent(tenantId, "signup_completed", { email: params.email ?? params.phone ?? "unknown" });
  await logOnboardingEvent(tenantId, "workspace_created", { workspaceId });
  await advanceOnboardingStep(tenantId, "ACCOUNT", "BUSINESS_PROFILE");

  return { tenantId, userId };
}
