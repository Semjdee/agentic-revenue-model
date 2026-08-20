import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { generateId } from "@/lib/ids";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { hasPermission } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { LEAD_STAGES } from "@/db/schema";
import { dispatchWebhooks } from "@/modules/webhooks/dispatch";
import { computeAttributionForOpportunity } from "@/modules/attribution/service";
import { syncOpportunityToCrm } from "@/modules/crm/sync";

const patchSchema = z.object({
  stage: z.enum(LEAD_STAGES).optional(),
  estimatedValue: z.string().optional(),
  actualSaleValue: z.string().optional(),
  lostReason: z.string().optional(),
  nextFollowUpAt: z.string().optional(),
  aiFollowUpEnabled: z.boolean().optional(),
  followUpObjective: z.string().optional(),
});

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  const [opp] = await db.select().from(schema.opportunities).where(and(eq(schema.opportunities.id, params.id), eq(schema.opportunities.tenantId, session.tenantId))).limit(1);
  if (!opp) return jsonError("Not found", 404);
  const tasksRows = await db.select().from(schema.tasks).where(eq(schema.tasks.opportunityId, params.id));
  return jsonOk({ opportunity: opp, tasks: tasksRows });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  if (!hasPermission(session.role, "opportunities", "edit")) return jsonError("Forbidden", 403);

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  const [before] = await db.select().from(schema.opportunities).where(and(eq(schema.opportunities.id, params.id), eq(schema.opportunities.tenantId, session.tenantId))).limit(1);
  if (!before) return jsonError("Not found", 404);

  const patch: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
  if (parsed.data.nextFollowUpAt) patch.nextFollowUpAt = new Date(parsed.data.nextFollowUpAt);

  await db.update(schema.opportunities).set(patch).where(eq(schema.opportunities.id, params.id));
  await logAudit({ tenantId: session.tenantId, userId: session.userId, action: "opportunity.updated", entity: "opportunity", entityId: params.id, before, after: parsed.data });

  let saleId: string | undefined;
  if (parsed.data.stage === "WON") {
    const amount = parsed.data.actualSaleValue ?? before.estimatedValue ?? "0";
    saleId = generateId();
    await db.insert(schema.sales).values({
      id: saleId,
      tenantId: session.tenantId,
      opportunityId: params.id,
      contactId: before.contactId,
      amount,
      currency: "UGX",
      products: before.products ?? [],
    });
    if (before.leadId) await db.update(schema.leads).set({ stage: "WON" }).where(eq(schema.leads.id, before.leadId));
    await logAudit({ tenantId: session.tenantId, userId: session.userId, action: "sale.created", entity: "sale", entityId: saleId, after: { amount } });
    await dispatchWebhooks(session.tenantId, "sale.created", { saleId, opportunityId: params.id, amount });
    await dispatchWebhooks(session.tenantId, "opportunity.won", { opportunityId: params.id });
    await computeAttributionForOpportunity(params.id, saleId);
  } else if (parsed.data.stage === "LOST") {
    if (before.leadId) await db.update(schema.leads).set({ stage: "LOST" }).where(eq(schema.leads.id, before.leadId));
    await dispatchWebhooks(session.tenantId, "opportunity.lost", { opportunityId: params.id });
  } else {
    await dispatchWebhooks(session.tenantId, "opportunity.updated", { opportunityId: params.id });
  }

  // Best-effort push to the tenant's connected CRM, if any — a manual
  // edit from the back office deserves the same sync a tool-call-driven
  // AI update gets (see modules/crm/sync.ts).
  await syncOpportunityToCrm(session.tenantId, params.id);

  return jsonOk({ ok: true, saleId });
}
