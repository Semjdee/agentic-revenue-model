import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { advanceOnboardingStep, logOnboardingEvent, setOnboardingAgent } from "@/modules/onboarding/service";

// docs/ONBOARDING_SPEC.md addendum §A9 — "Use Existing Agent" path. Does
// NOT create anything; just points this onboarding run at an agent that
// already exists (must belong to the same tenant — never trust an id from
// another tenant).
const bodySchema = z.object({ agentId: z.string().min(1) });

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  const [agent] = await db
    .select()
    .from(schema.agents)
    .where(and(eq(schema.agents.id, parsed.data.agentId), eq(schema.agents.tenantId, session.tenantId)))
    .limit(1);
  if (!agent) return jsonError("Agent not found", 404);

  await setOnboardingAgent(session.tenantId, agent.id);
  const progress = await advanceOnboardingStep(session.tenantId, "AGENT_SETUP", "AGENT_TEST");
  await logOnboardingEvent(session.tenantId, "agent_generated", { agentId: agent.id, reused: true });

  return jsonOk({ progress });
}
