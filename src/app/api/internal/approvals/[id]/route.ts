import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { hasPermission } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";

const bodySchema = z.object({ decision: z.enum(["APPROVED", "REJECTED"]) });

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  if (!hasPermission(session.role, "approvals", "approve")) return jsonError("Forbidden", 403);

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  const [approval] = await db
    .select()
    .from(schema.approvals)
    .where(and(eq(schema.approvals.id, params.id), eq(schema.approvals.tenantId, session.tenantId)))
    .limit(1);
  if (!approval) return jsonError("Not found", 404);

  await db.update(schema.approvals).set({ status: parsed.data.decision, decidedBy: session.userId, decidedAt: new Date() }).where(eq(schema.approvals.id, params.id));

  if (approval.type === "AGENT_ACTION") {
    const [actionRow] = await db.select().from(schema.agentActions).where(eq(schema.agentActions.id, approval.entityId)).limit(1);
    if (actionRow) {
      // Actions gated behind approval (e.g. offer_discount) currently have
      // no automated DB mutation of their own — approving them unblocks the
      // salesperson to act manually and the decision is fully audited.
      // A future action type with a real side effect would call
      // executeToolCalls() here with the stored parameters.
      await db
        .update(schema.agentActions)
        .set({ status: parsed.data.decision === "APPROVED" ? "EXECUTED" : "REJECTED", approver: session.userId })
        .where(eq(schema.agentActions.id, actionRow.id));
    }
  }

  await logAudit({ tenantId: session.tenantId, userId: session.userId, action: "approval.decided", entity: "approval", entityId: params.id, after: { decision: parsed.data.decision } });
  return jsonOk({ ok: true });
}
