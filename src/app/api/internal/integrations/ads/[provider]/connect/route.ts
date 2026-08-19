import { NextRequest } from "next/server";
import { db, schema } from "@/db/client";
import { generateId } from "@/lib/ids";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { hasPermission } from "@/lib/permissions";
import crypto from "crypto";
import { ADS_PROVIDERS } from "@/integrations/advertising/provider-config";

// Self-onboarding for advertising analytics — Instagram/Facebook/Google/
// TikTok Ads. Same staged, state-validated pattern as CRM
// (src/app/api/internal/integrations/crm/[provider]/**): one dynamic
// route covers every ad provider since MockAdsConnector is already
// provider-agnostic. Not the OAuthConnector flow (no webhook to
// register — these are pull/sync connections, not inbound message
// channels).
export async function POST(req: NextRequest, { params }: { params: { provider: string } }) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  if (!hasPermission(session.role, "integrations", "edit")) return jsonError("Forbidden", 403);
  if (!(params.provider in ADS_PROVIDERS)) return jsonError("Unknown advertising provider", 404);

  const body = await req.json().catch(() => ({}));
  const returnTo = typeof body?.returnTo === "string" && body.returnTo.startsWith("/") && !body.returnTo.startsWith("//") ? body.returnTo : "/integrations";

  const state = crypto.randomBytes(24).toString("hex");
  const redirectUri = "/onboarding/analytics-mock-consent";

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
    await db.insert(schema.integrations).values({ id: integrationId, tenantId: session.tenantId, provider: params.provider, category: "ADVERTISING", status: "PENDING", isMock: true, config });
  }

  const authorizationUrl = `${redirectUri}?provider=${encodeURIComponent(params.provider)}&state=${state}&return_to=${encodeURIComponent(returnTo)}`;
  return jsonOk({ authorizationUrl, state, integrationId });
}
