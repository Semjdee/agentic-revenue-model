import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { hasPermission } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { LEAD_STAGES } from "@/db/schema";
import { dispatchWebhooks } from "@/modules/webhooks/dispatch";
import { syncLeadToCrm } from "@/modules/crm/sync";

const patchSchema = z.object({
  stage: z.enum(LEAD_STAGES).optional(),
  score: z.number().optional(),
  assignedUserId: z.string().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  if (!hasPermission(session.role, "leads", "edit")) return jsonError("Forbidden", 403);

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  const [before] = await db.select().from(schema.leads).where(and(eq(schema.leads.id, params.id), eq(schema.leads.tenantId, session.tenantId))).limit(1);
  if (!before) return jsonError("Not found", 404);

  await db.update(schema.leads).set({ ...parsed.data, updatedAt: new Date() }).where(eq(schema.leads.id, params.id));
  await logAudit({ tenantId: session.tenantId, userId: session.userId, action: "lead.updated", entity: "lead", entityId: params.id, before, after: parsed.data });
  if (parsed.data.stage === "QUALIFIED") await dispatchWebhooks(session.tenantId, "lead.qualified", { leadId: params.id });
  else await dispatchWebhooks(session.tenantId, "lead.updated", { leadId: params.id });

  // Best-effort push to the tenant's connected CRM, if any (see
  // modules/crm/sync.ts) — same sync a tool-call-driven AI update gets.
  await syncLeadToCrm(session.tenantId, params.id);

  return jsonOk({ ok: true });
}
