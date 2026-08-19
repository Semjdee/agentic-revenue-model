import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { generateId } from "@/lib/ids";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";

// docs/ONBOARDING_SPEC.md section 15 — correction loop. Stored only; never
// auto-applied to the agent's config. A human reviews `correctionNote` and
// edits the agent explicitly via the normal agent-edit routes.
const bodySchema = z.object({
  testMessage: z.string().min(1),
  aiResponse: z.string().min(1),
  verdict: z.enum(["GOOD", "NEEDS_IMPROVEMENT"]),
  correctionNote: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  const id = generateId();
  await db.insert(schema.agentTestFeedback).values({
    id,
    tenantId: session.tenantId,
    agentId: params.id,
    ...parsed.data,
  });

  return jsonOk({ id }, 201);
}
