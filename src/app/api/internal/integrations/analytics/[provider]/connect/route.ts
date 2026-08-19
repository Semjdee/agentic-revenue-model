import { NextRequest } from "next/server";
import { db, schema } from "@/db/client";
import { generateId } from "@/lib/ids";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { hasPermission } from "@/lib/permissions";
import crypto from "crypto";

// Currently one provider (google_search_console) but kept as a dynamic
// route/category — same shape as the ads/CRM flows — rather than a
// one-off, so a second organic-analytics source (e.g. Bing Webmaster)
// slots in later without a new pattern.
const ANALYTICS_PROVIDERS: Record<string, { label: string }> = {
  google_search_console: { label: "Google Search (Organic)" },
};

export async function POST(req: NextRequest, { params }: { params: { provider: string } }) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  if (!hasPermission(session.role, "integrations", "edit")) return jsonError("Forbidden", 403);
  if (!(params.provider in ANALYTICS_PROVIDERS)) return jsonError("Unknown analytics provider", 404);

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
    await db.insert(schema.integrations).values({ id: integrationId, tenantId: session.tenantId, provider: params.provider, category: "ANALYTICS", status: "PENDING", isMock: true, config });
  }

  const authorizationUrl = `${redirectUri}?provider=${encodeURIComponent(params.provider)}&state=${state}&return_to=${encodeURIComponent(returnTo)}`;
  return jsonOk({ authorizationUrl, state, integrationId });
}
