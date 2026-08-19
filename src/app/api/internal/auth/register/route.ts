import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { generateId } from "@/lib/ids";
import { hashPassword, setSessionCookie } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { eq } from "drizzle-orm";
import { logAudit } from "@/lib/audit";
import { initOnboardingProgress, advanceOnboardingStep, logOnboardingEvent } from "@/modules/onboarding/service";
import { grantCredits } from "@/modules/billing/ledger";
import { FREE_TIER_GRANT_CREDITS } from "@/modules/billing/pricing";

const bodySchema = z.object({
  companyName: z.string().min(2),
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});

// Bootstraps a brand-new Tenant + Workspace + OWNER user. In a real product
// this would be gated behind a signup/billing flow; kept simple for the MVP
// so a fresh install can be created without manual DB seeding.
export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");
  const { companyName, name, email, password } = parsed.data;

  const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (existing) return jsonError("An account with this email already exists", 409);

  const tenantId = generateId();
  const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) + "-" + tenantId.slice(0, 6);
  await db.insert(schema.tenants).values({ id: tenantId, name: companyName, slug });

  const workspaceId = generateId();
  await db.insert(schema.workspaces).values({ id: workspaceId, tenantId, name: "Default Workspace" });

  const userId = generateId();
  const passwordHash = await hashPassword(password);
  await db.insert(schema.users).values({
    id: userId,
    tenantId,
    workspaceId,
    email,
    passwordHash,
    name,
    role: "OWNER",
  });

  await logAudit({ tenantId, userId, action: "tenant.created", entity: "tenant", entityId: tenantId, source: "APP" });

  // Free-tier credit grant (src/modules/billing/) — every new tenant starts
  // with a real, metered balance, not unlimited AI usage.
  await grantCredits(tenantId, FREE_TIER_GRANT_CREDITS, "GRANT", "free_tier_signup");

  // Zero-to-live self-onboarding (docs/ONBOARDING_SPEC.md) starts here —
  // every fresh signup gets a progress row + funnel events immediately,
  // not as an afterthought bolted onto some later step.
  await initOnboardingProgress(tenantId);
  await logOnboardingEvent(tenantId, "signup_completed", { email });
  await logOnboardingEvent(tenantId, "workspace_created", { workspaceId });
  // Reaching this line means account + workspace genuinely exist — mark
  // ACCOUNT done and land the wizard on BUSINESS_PROFILE next.
  await advanceOnboardingStep(tenantId, "ACCOUNT", "BUSINESS_PROFILE");

  await setSessionCookie({ userId, tenantId, role: "OWNER", email, name });
  return jsonOk({ tenantId, userId });
}
