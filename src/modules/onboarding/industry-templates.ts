import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { generateId } from "@/lib/ids";

// Industry templates service — Industry Team Subscription Architecture
// doc, Part A. Thin CRUD over industry_templates, used both by the
// tenant-facing picker (AGENT_SETUP step) and Platform Admin's editing
// surface. Deliberately no caching — this is a low-traffic, small table.

export interface IndustryTemplate {
  id: string;
  key: string;
  label: string;
  description: string | null;
  tone: string | null;
  qualificationQuestions: string[];
  salesRules: string[];
  restrictedTopics: string[];
  escalationConditions: string[];
  knowledgeBaseSuggestions: string[];
  productCategorySuggestions: string[];
  isActive: boolean;
}

function toTemplate(row: typeof schema.industryTemplates.$inferSelect): IndustryTemplate {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    description: row.description,
    tone: row.tone,
    qualificationQuestions: row.qualificationQuestions ?? [],
    salesRules: row.salesRules ?? [],
    restrictedTopics: row.restrictedTopics ?? [],
    escalationConditions: row.escalationConditions ?? [],
    knowledgeBaseSuggestions: row.knowledgeBaseSuggestions ?? [],
    productCategorySuggestions: row.productCategorySuggestions ?? [],
    isActive: row.isActive,
  };
}

export async function listIndustryTemplates(activeOnly = true): Promise<IndustryTemplate[]> {
  const rows = await db.select().from(schema.industryTemplates);
  return rows.filter((r) => !activeOnly || r.isActive).map(toTemplate);
}

export async function getIndustryTemplateByKey(key: string): Promise<IndustryTemplate | null> {
  const [row] = await db.select().from(schema.industryTemplates).where(eq(schema.industryTemplates.key, key)).limit(1);
  return row ? toTemplate(row) : null;
}

export async function createIndustryTemplate(input: Omit<IndustryTemplate, "id">): Promise<IndustryTemplate> {
  const id = generateId();
  await db.insert(schema.industryTemplates).values({ id, ...input });
  const [row] = await db.select().from(schema.industryTemplates).where(eq(schema.industryTemplates.id, id)).limit(1);
  return toTemplate(row);
}

export async function updateIndustryTemplate(id: string, patch: Partial<Omit<IndustryTemplate, "id" | "key">>): Promise<IndustryTemplate | null> {
  await db.update(schema.industryTemplates).set({ ...patch, updatedAt: new Date() }).where(eq(schema.industryTemplates.id, id));
  const [row] = await db.select().from(schema.industryTemplates).where(eq(schema.industryTemplates.id, id)).limit(1);
  return row ? toTemplate(row) : null;
}
