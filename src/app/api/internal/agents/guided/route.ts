import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { generateId, generatePublicAgentId } from "@/lib/ids";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { mapAnswersToAgentConfig, type GuidedSetupAnswers } from "@/modules/ai/guided-setup";
import { advanceOnboardingStep, logOnboardingEvent, setOnboardingAgent } from "@/modules/onboarding/service";

// docs/ONBOARDING_SPEC.md addendum — guided setup creates the SAME
// `agents` row manual creation does (src/app/api/internal/agents/route.ts),
// just populated via mapAnswersToAgentConfig() instead of direct form
// input. Never a parallel agent model (§A2). status defaults to DRAFT
// here specifically (overriding the column's ACTIVE default) so a
// guided-created agent never goes live until Go Live (§A14) — manual
// creation via the existing route is untouched and still defaults ACTIVE,
// exactly as before (§A6).

const answersSchema = z.object({
  whatDoYouSell: z.string().min(1),
  typicalCustomers: z.string().optional(),
  whatShouldAiHelpWith: z.string().optional(),
  whatToCollectFromLead: z.string().min(1),
  whatMakesLeadQualified: z.string().optional(),
  whenToHandOff: z.string().optional(),
  neverPromise: z.string().optional(),
  negotiatePrices: z.boolean().optional(),
  offerDelivery: z.boolean().optional(),
  locationsServed: z.string().optional(),
  languages: z.array(z.string()).optional(),
  tone: z.string().optional(),
});

/** Preview only — maps answers to a config for the review screen
 * (addendum §A4). Does not touch the database. */
export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);

  const parsed = answersSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, session.tenantId)).limit(1);
  const config = mapAnswersToAgentConfig(parsed.data as GuidedSetupAnswers, tenant?.name ?? "your business");
  return jsonOk(config);
}

const createSchema = z.object({
  name: z.string().min(1),
  role: z.string().optional(),
  company: z.string().optional(),
  instructions: z.string().optional(),
  tone: z.string().optional(),
  languageRules: z.array(z.string()).default([]),
  qualificationQuestions: z.array(z.string()).default([]),
  salesRules: z.array(z.string()).default([]),
  restrictedTopics: z.array(z.string()).default([]),
  escalationConditions: z.array(z.string()).default([]),
});

/** Creates the real agent from the (possibly user-edited, per addendum
 * §A4's "[ Edit ] [ Create Agent ]") reviewed config. */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);

  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  const id = generateId();
  await db.insert(schema.agents).values({
    id,
    tenantId: session.tenantId,
    publicAgentId: generatePublicAgentId(),
    ...parsed.data,
    creationMethod: "GUIDED",
    status: "DRAFT",
  });

  await logAudit({
    tenantId: session.tenantId,
    userId: session.userId,
    action: "agent.created",
    entity: "agent",
    entityId: id,
    after: { ...parsed.data, creationMethod: "GUIDED", status: "DRAFT" },
  });

  await setOnboardingAgent(session.tenantId, id);
  const progress = await advanceOnboardingStep(session.tenantId, "AGENT_SETUP", "AGENT_TEST");
  await logOnboardingEvent(session.tenantId, "agent_generated", { agentId: id });

  return jsonOk({ id, progress }, 201);
}
