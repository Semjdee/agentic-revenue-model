import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { listIndustryTemplates } from "@/modules/onboarding/industry-templates";

// Tenant-facing list — used by the onboarding wizard's AGENT_SETUP step
// (Industry Team Subscription Architecture doc, Part A) and available for
// the agent builder later. Active templates only; Platform Admin can see
// and edit inactive ones via /api/platform/industry-templates.
export async function GET() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  const templates = await listIndustryTemplates(true);
  return jsonOk({ templates });
}
