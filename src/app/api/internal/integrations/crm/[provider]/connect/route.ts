import { NextRequest } from "next/server";
import { db, schema } from "@/db/client";
import { generateId } from "@/lib/ids";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { CRM_PROVIDERS } from "@/integrations/crm/mock-connector";
import crypto from "crypto";

// docs/ONBOARDING_TASKS.md P1 backlog — CRM connector onboarding. Same
// staged, state-validated pattern as WhatsApp/Instagram
// (src/integrations/oauth/connect-flow.ts), adapted for the CRMConnector
// interface (src/integrations/crm/types.ts) rather than OAuthConnector —
// CRM connectors authenticate with account credentials, not a
// browser-redirect authorization code, so this is a parallel (not
// identical) flow, not forced through the OAuth-shaped one. One dynamic
// route covers all six CRM providers since MockCRMConnector is already
// provider-agnostic (src/integrations/crm/mock-connector.ts).
export async function POST(req: NextRequest, { params }: { params: { provider: string } }) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  if (!(CRM_PROVIDERS as readonly string[]).includes(params.provider)) return jsonError("Unknown CRM provider", 404);

  const body = await req.json().catch(() => ({}));
  const returnTo = typeof body?.returnTo === "string" && body.returnTo.startsWith("/") && !body.returnTo.startsWith("//") ? body.returnTo : "/integrations";

  const state = crypto.randomBytes(24).toString("hex");
  const redirectUri = "/onboarding/crm-mock-consent";

  const [existing] = await db
    .select()
    .from(schema.integrations)
    .where(and(eq(schema.integrations.tenantId, session.tenantId), eq(schema.integrations.provider, params.provider)))
    .limit(1);

  const config = { state, redirectUri, initiatedByUserId: session.userId, returnTo };
  let integrationId: string;
  if (existing) {
    integrationId = existing.id;
    await db.update(schema.integrations).set({ status: "PENDING", config }).where(eq(schema.integrations.id, existing.id));
  } else {
    integrationId = generateId();
    await db.insert(schema.integrations).values({ id: integrationId, tenantId: session.tenantId, provider: params.provider, category: "CRM", status: "PENDING", isMock: true, config });
  }

  const authorizationUrl = `${redirectUri}?provider=${encodeURIComponent(params.provider)}&state=${state}&return_to=${encodeURIComponent(returnTo)}`;
  return jsonOk({ authorizationUrl, state, integrationId });
}
