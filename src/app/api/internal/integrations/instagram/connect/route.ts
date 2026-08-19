import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { initiateOAuthConnect } from "@/integrations/oauth/connect-flow";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  const body = await req.json().catch(() => ({}));
  const returnTo = typeof body?.returnTo === "string" ? body.returnTo : "/onboarding";
  return jsonOk(await initiateOAuthConnect(session, "instagram", "MESSAGING", "/onboarding/instagram-mock-consent", returnTo));
}
