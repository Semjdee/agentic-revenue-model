import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { requirePlatformSession } from "@/lib/platform-auth";
import { updateIndustryTemplate } from "@/modules/onboarding/industry-templates";

const patchSchema = z.object({
  label: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  tone: z.string().nullable().optional(),
  qualificationQuestions: z.array(z.string()).optional(),
  salesRules: z.array(z.string()).optional(),
  restrictedTopics: z.array(z.string()).optional(),
  escalationConditions: z.array(z.string()).optional(),
  knowledgeBaseSuggestions: z.array(z.string()).optional(),
  productCategorySuggestions: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requirePlatformSession();
  } catch {
    return jsonError("Not authenticated", 401);
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  const template = await updateIndustryTemplate(params.id, parsed.data);
  if (!template) return jsonError("Template not found", 404);
  return jsonOk({ template });
}
