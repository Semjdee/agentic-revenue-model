import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { requirePlatformSession } from "@/lib/platform-auth";
import { listIndustryTemplates, createIndustryTemplate } from "@/modules/onboarding/industry-templates";

// Platform-Admin CRUD for industry templates (Industry Team Subscription
// Architecture doc, Part A/E) — templates must be editable without a
// redeploy, so adding/tuning an industry vertical is a data change made
// here, not a code change. Same requirePlatformSession() gate as every
// other platform route.

const createSchema = z.object({
  key: z.string().min(1).regex(/^[A-Z_]+$/, "Use SCREAMING_SNAKE_CASE, e.g. SOLAR"),
  label: z.string().min(1),
  description: z.string().optional(),
  tone: z.string().optional(),
  qualificationQuestions: z.array(z.string()).default([]),
  salesRules: z.array(z.string()).default([]),
  restrictedTopics: z.array(z.string()).default([]),
  escalationConditions: z.array(z.string()).default([]),
  knowledgeBaseSuggestions: z.array(z.string()).default([]),
  productCategorySuggestions: z.array(z.string()).default([]),
});

export async function GET() {
  try {
    await requirePlatformSession();
  } catch {
    return jsonError("Not authenticated", 401);
  }
  const templates = await listIndustryTemplates(false);
  return jsonOk({ templates });
}

// No logAudit() call here — audit_logs.tenantId is NOT NULL (tenant-scoped
// by design) and this is a platform-level, tenant-less action. Platform
// staff actions on tenant-scoped resources (e.g. the plan-change route)
// still audit normally.
export async function POST(req: NextRequest) {
  try {
    await requirePlatformSession();
  } catch {
    return jsonError("Not authenticated", 401);
  }

  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  const template = await createIndustryTemplate({ ...parsed.data, description: parsed.data.description ?? null, tone: parsed.data.tone ?? null, isActive: true });

  return jsonOk({ template }, 201);
}
