import { NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { runSandboxMessage } from "@/modules/ai/sandbox";
import { logOnboardingEventOnce } from "@/modules/onboarding/service";

// docs/ONBOARDING_SPEC.md section 14 / addendum §A13 — available both from
// the onboarding wizard's AGENT_TEST step and persistently from
// src/app/(app)/agents/[id]/page.tsx. Same route, same sandbox module,
// used by both callers — not two implementations.
const bodySchema = z.object({
  message: z.string().min(1),
  history: z.array(z.object({ sender: z.enum(["CUSTOMER", "AI"]), content: z.string() })).default([]),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  try {
    const result = await runSandboxMessage({
      tenantId: session.tenantId,
      agentId: params.id,
      history: parsed.data.history,
      latestMessage: parsed.data.message,
    });
    // Fires at most once per tenant regardless of how many test messages
    // are sent — this event marks "the funnel stage was reached", not "a
    // message was sent".
    await logOnboardingEventOnce(session.tenantId, "agent_test_started");
    return jsonOk(result);
  } catch (err) {
    if (err instanceof Error && err.message === "Agent not found") return jsonError("Agent not found", 404);
    throw err;
  }
}
