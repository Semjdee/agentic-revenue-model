import { NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { completeOAuthCallback } from "@/integrations/oauth/connect-flow";

const bodySchema = z.object({
  code: z.string().min(1), // JSON blob from the mock consent step
  state: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  const result = await completeOAuthCallback(session, "instagram", parsed.data.code, parsed.data.state);
  if (!result.ok) return jsonError(result.message, result.status, result.code);
  return jsonOk({ ok: true, externalAccountName: result.externalAccountName });
}
