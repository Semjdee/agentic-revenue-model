import { db, schema } from "@/db/client";
import { generateId } from "@/lib/ids";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { getOAuthConnector } from "@/integrations/oauth/whatsapp-mock-connector";
import crypto from "crypto";

// docs/ONBOARDING_SPEC.md section 6 / docs/PHASE_2_EXTENSIONS_SPEC.md
// section 12 — issues a CSRF-protection `state`, stashes it server-side
// against a PENDING integration row (never trust a state the client
// echoes back without this), and returns where to send the user next.
export async function POST() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);

  const state = crypto.randomBytes(24).toString("hex");
  const redirectUri = "/onboarding/whatsapp-mock-consent";

  const [existing] = await db
    .select()
    .from(schema.integrations)
    .where(and(eq(schema.integrations.tenantId, session.tenantId), eq(schema.integrations.provider, "whatsapp")))
    .limit(1);

  const config = { state, redirectUri, initiatedByUserId: session.userId };
  let integrationId: string;
  if (existing) {
    integrationId = existing.id;
    await db.update(schema.integrations).set({ status: "PENDING", config }).where(eq(schema.integrations.id, existing.id));
  } else {
    integrationId = generateId();
    await db.insert(schema.integrations).values({
      id: integrationId,
      tenantId: session.tenantId,
      provider: "whatsapp",
      category: "MESSAGING",
      status: "PENDING",
      isMock: true,
      config,
    });
  }

  const connector = getOAuthConnector("whatsapp");
  const authorizationUrl = await connector.getAuthorizationUrl({ tenantId: session.tenantId, state, redirectUri });

  return jsonOk({ authorizationUrl, state, integrationId });
}
