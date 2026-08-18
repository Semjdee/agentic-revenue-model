import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { hasPermission } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { dispatchWebhooks } from "@/modules/webhooks/dispatch";
import { getAdsConnector } from "@/integrations/advertising/mock-connector";

const bodySchema = z.object({ decision: z.enum(["APPROVED", "REJECTED"]) });

// Human approval gate for AI Advertising Analyst recommendations (spec
// section 15: "The user must approve budget-impacting actions... After
// approval, the integration service may execute the authorized action.
// Every executed advertising change must enter the Audit Log.")
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  if (!hasPermission(session.role, "advertising", "approve")) return jsonError("Forbidden", 403);

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  const [rec] = await db
    .select()
    .from(schema.advertisingRecommendations)
    .where(and(eq(schema.advertisingRecommendations.id, params.id), eq(schema.advertisingRecommendations.tenantId, session.tenantId)))
    .limit(1);
  if (!rec) return jsonError("Not found", 404);

  await db
    .update(schema.advertisingRecommendations)
    .set({ status: parsed.data.decision, decidedBy: session.userId, decidedAt: new Date() })
    .where(eq(schema.advertisingRecommendations.id, params.id));

  if (parsed.data.decision === "APPROVED" && rec.campaignId) {
    const [campaign] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, rec.campaignId)).limit(1);
    if (campaign && (rec.title === "Increase Budget" || rec.title === "Reduce Budget")) {
      const currentBudget = Number(campaign.dailyBudget ?? 0);
      const delta = rec.title === "Increase Budget" ? 0.15 : -0.3;
      const newBudget = Math.round(currentBudget * (1 + delta));
      const [adAccount] = await db.select().from(schema.adAccounts).where(eq(schema.adAccounts.id, campaign.adAccountId)).limit(1);
      const connector = getAdsConnector((adAccount?.provider as "GOOGLE" | "META") ?? "META");
      await connector.updateBudget(campaign.externalId, newBudget);
      await db.update(schema.campaigns).set({ dailyBudget: String(newBudget) }).where(eq(schema.campaigns.id, campaign.id));

      await logAudit({
        tenantId: session.tenantId,
        userId: session.userId,
        action: "advertising.budget_changed",
        entity: "campaign",
        entityId: campaign.id,
        before: { dailyBudget: currentBudget },
        after: { dailyBudget: newBudget },
      });
    }
    await db.update(schema.advertisingRecommendations).set({ status: "IMPLEMENTED" }).where(eq(schema.advertisingRecommendations.id, params.id));
    await dispatchWebhooks(session.tenantId, "recommendation.approved", { recommendationId: params.id });
  }

  await logAudit({
    tenantId: session.tenantId,
    userId: session.userId,
    action: "advertising.recommendation_decided",
    entity: "advertising_recommendation",
    entityId: params.id,
    after: { decision: parsed.data.decision },
  });

  return jsonOk({ ok: true });
}
