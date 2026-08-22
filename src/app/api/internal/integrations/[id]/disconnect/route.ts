import { NextRequest } from "next/server";
import { db, schema } from "@/db/client";
import { and, eq, desc } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { decryptSecret } from "@/lib/crypto";
import { getOAuthConnector } from "@/integrations/oauth/registry";

const OAUTH_CONNECTOR_PROVIDERS = ["whatsapp", "instagram"];

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);

  // Best-effort real unregister/revoke before flipping local status —
  // previously this route only ever updated our own DB, never told the
  // provider the connection was going away (harmless for the mock
  // connectors, but a real WhatsApp/Instagram connection left its webhook
  // subscription live at Meta forever). A failure here must never block
  // disconnecting locally — a tenant needs to be able to disconnect even
  // if the remote call errors.
  if (OAUTH_CONNECTOR_PROVIDERS.includes(params.id)) {
    const [integration] = await db
      .select()
      .from(schema.integrations)
      .where(and(eq(schema.integrations.tenantId, session.tenantId), eq(schema.integrations.provider, params.id)))
      .limit(1);
    if (integration && !integration.isMock) {
      try {
        const [cred] = await db
          .select()
          .from(schema.integrationCredentials)
          .where(eq(schema.integrationCredentials.integrationId, integration.id))
          .orderBy(desc(schema.integrationCredentials.createdAt))
          .limit(1);
        if (cred) {
          const tokens = JSON.parse(decryptSecret(cred.encryptedPayload)) as { accessToken: string; extra?: Record<string, unknown> };
          const connector = getOAuthConnector(params.id);
          await connector.unregisterWebhooks(tokens.accessToken, tokens.extra);
          await connector.revokeAccess(tokens.accessToken);
        }
      } catch (err) {
        console.warn(`[disconnect] remote unregister failed for ${params.id}/${session.tenantId} — proceeding with local disconnect anyway`, err);
      }
    }
  }

  await db
    .update(schema.integrations)
    .set({ status: "NOT_CONNECTED" })
    .where(and(eq(schema.integrations.tenantId, session.tenantId), eq(schema.integrations.provider, params.id)));

  await logAudit({ tenantId: session.tenantId, userId: session.userId, action: "integration.disconnected", entity: "integration", entityId: params.id });
  return jsonOk({ ok: true });
}
