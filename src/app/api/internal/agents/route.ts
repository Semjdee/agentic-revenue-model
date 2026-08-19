import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { generateId, generatePublicAgentId } from "@/lib/ids";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { hasPermission } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { getOnboardingProgress, setOnboardingAgent, advanceOnboardingStep, logOnboardingEvent } from "@/modules/onboarding/service";

const bodySchema = z.object({
  name: z.string().min(1),
  role: z.string().optional(),
  company: z.string().optional(),
  instructions: z.string().optional(),
  tone: z.string().optional(),
  greeting: z.string().optional(),
  qualificationQuestions: z.array(z.string()).default([]),
  restrictedTopics: z.array(z.string()).default([]),
  escalationConditions: z.array(z.string()).default([]),
  salesRules: z.array(z.string()).default([]),
  widgetColor: z.string().optional(),
});

export async function GET() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  const rows = await db.select().from(schema.agents).where(eq(schema.agents.tenantId, session.tenantId));
  return jsonOk(rows);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  if (!hasPermission(session.role, "agents", "create")) return jsonError("Forbidden", 403);

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  const id = generateId();
  await db.insert(schema.agents).values({ id, tenantId: session.tenantId, publicAgentId: generatePublicAgentId(), ...parsed.data });
  await logAudit({ tenantId: session.tenantId, userId: session.userId, action: "agent.created", entity: "agent", entityId: id });

  // Manual creation stays exactly as before for everyone (docs/ONBOARDING_SPEC.md
  // addendum §A6) — this only fires if the tenant happens to be mid-onboarding
  // at the AGENT_SETUP step (i.e. they picked "Create Manually" from the
  // wizard, addendum §A1), so the wizard learns which agent to continue with
  // instead of being stuck not knowing a manual agent was just created.
  const progress = await getOnboardingProgress(session.tenantId);
  if (progress && progress.currentStep === "AGENT_SETUP") {
    await setOnboardingAgent(session.tenantId, id);
    await advanceOnboardingStep(session.tenantId, "AGENT_SETUP", "AGENT_TEST");
    await logOnboardingEvent(session.tenantId, "agent_generated", { agentId: id, method: "manual" });
  }

  return jsonOk({ id }, 201);
}
