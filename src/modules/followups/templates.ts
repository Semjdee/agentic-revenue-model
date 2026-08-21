import { db, schema } from "@/db/client";
import { generateId } from "@/lib/ids";
import { and, eq, asc, inArray } from "drizzle-orm";

// ============================================================================
// Follow-up templates & sequences — tenant-owned messages the follow-up
// engine (processor.ts) actually sends, replacing the two strings that
// used to be hardcoded directly there. See schema.ts's header comment on
// followUpTemplates/followUpSequences/followUpSequenceSteps for the full
// design reasoning (modeled as ordered steps now so a later multi-step
// workflow-builder pass is additive, not a migration).
// ============================================================================

const DEFAULT_REPEAT_INTERVAL_HOURS = 48; // matches the old REPEAT_INTERVAL_HOURS constant exactly, so an untouched tenant's timing doesn't change

const DEFAULT_TEMPLATES = [
  { name: "Default first follow-up", messageBody: "Hi again! Just checking in on the {{objective}} we discussed — would you like to go ahead?" },
  { name: "Default repeat follow-up", messageBody: "Hi, following up once more on your request — happy to answer any questions before you decide." },
] as const;

/**
 * Every tenant needs exactly one default sequence to fall back to when an
 * opportunity has no explicit followUpSequenceId — this creates one
 * (with the 2 default templates above, wired as its 2 steps) the first
 * time it's needed for a tenant, and is a no-op for every call after
 * that. Deliberately reproduces the OLD hardcoded engine's exact wording
 * and 48h cadence, so a tenant who never opens the new Follow-up
 * Templates settings sees zero behavior change.
 */
export async function ensureDefaultFollowUpSequence(tenantId: string) {
  const [existing] = await db
    .select()
    .from(schema.followUpSequences)
    .where(and(eq(schema.followUpSequences.tenantId, tenantId), eq(schema.followUpSequences.isDefault, true)))
    .limit(1);
  if (existing) return existing;

  const templateIds: string[] = [];
  for (const t of DEFAULT_TEMPLATES) {
    const id = generateId();
    await db.insert(schema.followUpTemplates).values({ id, tenantId, name: t.name, messageBody: t.messageBody });
    templateIds.push(id);
  }

  const sequenceId = generateId();
  await db.insert(schema.followUpSequences).values({ id: sequenceId, tenantId, name: "Default sequence", isDefault: true });
  await db.insert(schema.followUpSequenceSteps).values(
    templateIds.map((templateId, i) => ({
      id: generateId(),
      tenantId,
      sequenceId,
      stepOrder: i,
      templateId,
      delayHours: DEFAULT_REPEAT_INTERVAL_HOURS,
    }))
  );

  const [created] = await db.select().from(schema.followUpSequences).where(eq(schema.followUpSequences.id, sequenceId)).limit(1);
  return created;
}

export interface SequenceStepWithTemplate {
  id: string;
  stepOrder: number;
  delayHours: number;
  template: { id: string; name: string; messageBody: string };
}

export async function getSequenceSteps(sequenceId: string): Promise<SequenceStepWithTemplate[]> {
  const steps = await db.select().from(schema.followUpSequenceSteps).where(eq(schema.followUpSequenceSteps.sequenceId, sequenceId)).orderBy(asc(schema.followUpSequenceSteps.stepOrder));
  const templateIds = [...new Set(steps.map((s) => s.templateId))];
  const templates = templateIds.length ? await db.select().from(schema.followUpTemplates).where(inArray(schema.followUpTemplates.id, templateIds)) : [];
  const templateById = new Map(templates.map((t) => [t.id, t]));

  return steps
    .map((s) => {
      const t = templateById.get(s.templateId);
      if (!t) return null;
      return { id: s.id, stepOrder: s.stepOrder, delayHours: s.delayHours, template: { id: t.id, name: t.name, messageBody: t.messageBody } };
    })
    .filter((s): s is SequenceStepWithTemplate => s !== null);
}

/** Resolves the sequence an opportunity's follow-ups should use — its
 * explicit followUpSequenceId, or the tenant's default (auto-created if
 * this is the first follow-up this tenant has ever triggered). */
export async function resolveOpportunitySequence(tenantId: string, followUpSequenceId: string | null) {
  if (followUpSequenceId) {
    const [seq] = await db.select().from(schema.followUpSequences).where(and(eq(schema.followUpSequences.id, followUpSequenceId), eq(schema.followUpSequences.tenantId, tenantId))).limit(1);
    if (seq) return seq;
    // Explicit sequence was deleted out from under this opportunity — fall
    // through to the default rather than leaving it permanently stuck.
  }
  return ensureDefaultFollowUpSequence(tenantId);
}

/** Which step an attempt number (0-indexed) should use — clamped to the
 * last configured step once attempts exceed the sequence's step count,
 * so a 3-attempt engine against a 2-step sequence repeats step 2 for
 * attempt 3, same as the old hardcoded "any attempt after the first uses
 * message 2" behavior, generalized to N steps. */
export function resolveStepForAttempt(steps: SequenceStepWithTemplate[], attemptIndex: number): SequenceStepWithTemplate | null {
  if (steps.length === 0) return null;
  return steps[Math.min(attemptIndex, steps.length - 1)];
}

export interface TemplateRenderContext {
  contactName?: string | null;
  objective?: string | null;
  product?: string | null;
  businessName?: string | null;
}

const VARIABLE_FALLBACKS: Record<keyof TemplateRenderContext, string> = {
  contactName: "there",
  objective: "your request",
  product: "your order",
  businessName: "us",
};

/** Simple {{variable}} interpolation — never leaves a raw {{var}} in a
 * sent customer message; an unresolvable/missing value falls back to a
 * generic but still natural-reading phrase (see VARIABLE_FALLBACKS)
 * rather than an empty gap or the literal template syntax. */
export function renderFollowUpTemplate(body: string, ctx: TemplateRenderContext): string {
  const values: Record<string, string | null | undefined> = {
    contact_name: ctx.contactName,
    objective: ctx.objective,
    product: ctx.product,
    business_name: ctx.businessName,
  };
  const fallbackByKey: Record<string, string> = {
    contact_name: VARIABLE_FALLBACKS.contactName,
    objective: VARIABLE_FALLBACKS.objective,
    product: VARIABLE_FALLBACKS.product,
    business_name: VARIABLE_FALLBACKS.businessName,
  };
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key) => {
    const normalizedKey = key.toLowerCase();
    const value = values[normalizedKey];
    if (value && value.trim()) return value.trim();
    return fallbackByKey[normalizedKey] ?? match;
  });
}

export const AVAILABLE_TEMPLATE_VARIABLES = [
  { key: "contact_name", description: "The customer's name (falls back to \"there\" if unknown)" },
  { key: "objective", description: "This opportunity's follow-up objective, e.g. \"quotation\" (falls back to \"your request\")" },
  { key: "product", description: "The first product discussed on this opportunity (falls back to \"your order\")" },
  { key: "business_name", description: "Your business name (falls back to \"us\")" },
] as const;
