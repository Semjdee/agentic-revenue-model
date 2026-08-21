import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { hasPermission } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  messageBody: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  if (!hasPermission(session.role, "followups", "edit")) return jsonError("Forbidden", 403);

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  const [before] = await db.select().from(schema.followUpTemplates).where(and(eq(schema.followUpTemplates.id, params.id), eq(schema.followUpTemplates.tenantId, session.tenantId))).limit(1);
  if (!before) return jsonError("Not found", 404);

  await db.update(schema.followUpTemplates).set({ ...parsed.data, updatedAt: new Date() }).where(eq(schema.followUpTemplates.id, params.id));
  await logAudit({ tenantId: session.tenantId, userId: session.userId, action: "followup_template.updated", entity: "follow_up_template", entityId: params.id, before, after: parsed.data });

  return jsonOk({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  if (!hasPermission(session.role, "followups", "delete")) return jsonError("Forbidden", 403);

  const [template] = await db.select().from(schema.followUpTemplates).where(and(eq(schema.followUpTemplates.id, params.id), eq(schema.followUpTemplates.tenantId, session.tenantId))).limit(1);
  if (!template) return jsonError("Not found", 404);

  const stepsUsingIt = await db.select().from(schema.followUpSequenceSteps).where(eq(schema.followUpSequenceSteps.templateId, params.id));
  if (stepsUsingIt.length > 0) {
    // Friendly pre-check ahead of the DB's own onDelete: "restrict" —
    // same rule, better error message than a raw foreign-key violation.
    return jsonError("This template is currently used by your follow-up sequence — assign a different template to that step before deleting it.", 409, "TEMPLATE_IN_USE");
  }

  await db.delete(schema.followUpTemplates).where(eq(schema.followUpTemplates.id, params.id));
  await logAudit({ tenantId: session.tenantId, userId: session.userId, action: "followup_template.deleted", entity: "follow_up_template", entityId: params.id, before: template });

  return jsonOk({ ok: true });
}
