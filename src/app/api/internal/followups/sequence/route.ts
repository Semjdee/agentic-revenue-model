import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { hasPermission } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { ensureDefaultFollowUpSequence, getSequenceSteps } from "@/modules/followups/templates";

// Backs the "which template sends at which attempt" part of Settings →
// Follow-up Templates. Deliberately only edits the EXISTING steps of the
// tenant's default sequence (assign a different template, change the
// delay) rather than exposing add/remove/reorder-arbitrary-steps — that
// full workflow-builder UI is the deliberately-deferred next pass; the
// schema underneath (followUpSequences/followUpSequenceSteps) is already
// shaped for it.
const patchSchema = z.object({
  steps: z.array(z.object({ stepId: z.string(), templateId: z.string(), delayHours: z.number().int().min(1).max(720) })),
});

export async function GET() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);

  const sequence = await ensureDefaultFollowUpSequence(session.tenantId);
  const steps = await getSequenceSteps(sequence.id);
  return jsonOk({ sequence, steps });
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  if (!hasPermission(session.role, "followups", "edit")) return jsonError("Forbidden", 403);

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  const sequence = await ensureDefaultFollowUpSequence(session.tenantId);
  const existingSteps = await db.select().from(schema.followUpSequenceSteps).where(eq(schema.followUpSequenceSteps.sequenceId, sequence.id));
  const existingStepIds = new Set(existingSteps.map((s) => s.id));

  for (const update of parsed.data.steps) {
    if (!existingStepIds.has(update.stepId)) return jsonError("Unknown step", 422, "VALIDATION_ERROR");
    const [template] = await db.select().from(schema.followUpTemplates).where(and(eq(schema.followUpTemplates.id, update.templateId), eq(schema.followUpTemplates.tenantId, session.tenantId))).limit(1);
    if (!template) return jsonError("Unknown template", 422, "VALIDATION_ERROR");
  }

  for (const update of parsed.data.steps) {
    await db.update(schema.followUpSequenceSteps).set({ templateId: update.templateId, delayHours: update.delayHours }).where(eq(schema.followUpSequenceSteps.id, update.stepId));
  }

  await logAudit({ tenantId: session.tenantId, userId: session.userId, action: "followup_sequence.updated", entity: "follow_up_sequence", entityId: sequence.id, after: { steps: parsed.data.steps } });

  const steps = await getSequenceSteps(sequence.id);
  return jsonOk({ sequence, steps });
}
