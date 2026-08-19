import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { advanceOnboardingStep, logOnboardingEvent } from "@/modules/onboarding/service";

// docs/ONBOARDING_SPEC.md section 4 Step 2 — "ask only essential
// information", so this intentionally stays a short schema, not an
// exhaustive business-details form.
const bodySchema = z.object({
  businessName: z.string().min(1).optional(),
  industry: z.string().min(1).optional(),
  country: z.string().min(1).optional(),
  currency: z.string().min(1).optional(),
  timezone: z.string().min(1).optional(),
  websiteUrl: z.string().url().optional().or(z.literal("")),
  description: z.string().max(2000).optional(),
  primaryObjective: z.string().min(1).optional(),
  primaryChannel: z.string().min(1).optional(),
});

export async function GET() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, session.tenantId)).limit(1);
  if (!tenant) return jsonError("Tenant not found", 404);
  return jsonOk(tenant);
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");
  const { businessName, ...profile } = parsed.data;

  const [before] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, session.tenantId)).limit(1);
  if (!before) return jsonError("Tenant not found", 404);

  await db
    .update(schema.tenants)
    .set({
      ...(businessName ? { name: businessName } : {}),
      ...profile,
      // Empty string from an optional URL field means "cleared", not
      // "leave unset" — normalize to null so it doesn't fail the url()
      // check on a future PATCH.
      websiteUrl: profile.websiteUrl === "" ? null : profile.websiteUrl,
      updatedAt: new Date(),
    })
    .where(eq(schema.tenants.id, session.tenantId));

  await logAudit({
    tenantId: session.tenantId,
    userId: session.userId,
    action: "tenant.business_profile_updated",
    entity: "tenant",
    entityId: session.tenantId,
    before: { name: before.name, industry: before.industry, country: before.country },
    after: { name: businessName ?? before.name, ...profile },
  });

  const progress = await advanceOnboardingStep(session.tenantId, "BUSINESS_PROFILE", "KNOWLEDGE_IMPORT");
  await logOnboardingEvent(session.tenantId, "business_profile_completed", profile);

  return jsonOk({ progress });
}
