import { NextRequest } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { generateId } from "@/lib/ids";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";
import { encryptSecret } from "@/lib/crypto";
import { logAudit } from "@/lib/audit";
import { getAdsConnector } from "@/integrations/advertising/mock-connector";
import { ADS_PROVIDERS } from "@/integrations/advertising/provider-config";

const bodySchema = z.object({ accountName: z.string().min(1), state: z.string().min(1) });

// Same rigor as CRM's callback (src/app/api/internal/integrations/crm/[provider]/callback):
// state validated, never CONNECTED unless authenticate() AND
// testConnection() both genuinely succeed. Then does what a real
// connector's first sync would: pulls campaigns and a 30-day metric
// backfill into the SAME ad_accounts/campaigns/ad_metric_snapshots tables
// the Advertising dashboard already reads — so the moment self-onboarding
// finishes, the Advertising and Attribution pages have real rows to show,
// not just a "Connected" badge.
export async function POST(req: NextRequest, { params }: { params: { provider: string } }) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  const meta = ADS_PROVIDERS[params.provider];
  if (!meta) return jsonError("Unknown advertising provider", 404);

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid input", 422, "VALIDATION_ERROR");

  const [row] = await db
    .select()
    .from(schema.integrations)
    .where(and(eq(schema.integrations.tenantId, session.tenantId), eq(schema.integrations.provider, params.provider)))
    .limit(1);
  if (!row || row.status !== "PENDING") {
    return jsonError(`No pending ${meta.label} connection for this workspace — start over from Connect.`, 409);
  }

  const expectedState = (row.config as { state?: string } | null)?.state;
  if (!parsed.data.state || parsed.data.state !== expectedState) {
    await db.update(schema.integrations).set({ status: "ERROR" }).where(eq(schema.integrations.id, row.id));
    await logAudit({ tenantId: session.tenantId, userId: session.userId, action: "integration.connect_failed", entity: "integration", entityId: row.id, after: { provider: params.provider, reason: "STATE_MISMATCH" } });
    return jsonError("We couldn't verify that request — please try connecting again.", 400, "STATE_MISMATCH");
  }

  const connector = getAdsConnector(meta.connectorProvider, meta.platformLabel);
  const credentials = { accountName: parsed.data.accountName };

  const authResult = await connector.authenticate(credentials);
  const testResult = authResult.ok ? await connector.testConnection() : { ok: false, detail: undefined as string | undefined };

  if (!authResult.ok || !testResult.ok) {
    await db.update(schema.integrations).set({ status: "ERROR" }).where(eq(schema.integrations.id, row.id));
    await logAudit({ tenantId: session.tenantId, userId: session.userId, action: "integration.connect_failed", entity: "integration", entityId: row.id, after: { provider: params.provider, testDetail: testResult.detail } });
    return jsonError(`We couldn't finish connecting ${meta.label}.`, 502, "VERIFICATION_FAILED");
  }

  const externalAccountId = `${meta.connectorProvider.toLowerCase()}_${parsed.data.accountName.toLowerCase().replace(/\s+/g, "-")}`;

  // ad_accounts is keyed by (tenant, provider, externalAccountId) in
  // practice — Instagram Ads and Facebook Ads are separate integrations
  // rows but can share a Meta ad account id, so look up by the triple,
  // not just provider.
  const [existingAccount] = await db
    .select()
    .from(schema.adAccounts)
    .where(and(eq(schema.adAccounts.tenantId, session.tenantId), eq(schema.adAccounts.provider, meta.connectorProvider), eq(schema.adAccounts.externalAccountId, externalAccountId)))
    .limit(1);

  const adAccountId = existingAccount?.id ?? generateId();
  if (!existingAccount) {
    await db.insert(schema.adAccounts).values({
      id: adAccountId,
      tenantId: session.tenantId,
      provider: meta.connectorProvider,
      externalAccountId,
      name: parsed.data.accountName,
      status: "CONNECTED",
      isMock: true,
    });
  }

  // Initial sync — campaigns + a 30-day metric backfill, idempotent on
  // re-connect (checked by externalId before insert).
  const normalizedCampaigns = await connector.listCampaigns();
  for (const nc of normalizedCampaigns) {
    const [existingCampaign] = await db.select({ id: schema.campaigns.id }).from(schema.campaigns).where(and(eq(schema.campaigns.tenantId, session.tenantId), eq(schema.campaigns.externalId, nc.externalId))).limit(1);
    const campaignId = existingCampaign?.id ?? generateId();
    if (!existingCampaign) {
      await db.insert(schema.campaigns).values({
        id: campaignId,
        tenantId: session.tenantId,
        adAccountId,
        externalId: nc.externalId,
        name: nc.name,
        status: nc.status,
        objective: nc.objective,
        dailyBudget: nc.dailyBudget?.toString(),
        currency: nc.currency,
      });

      const metrics = await connector.getMetrics(nc.externalId, 30);
      for (const m of metrics) {
        await db.insert(schema.adMetricSnapshots).values({
          id: generateId(),
          tenantId: session.tenantId,
          campaignId,
          date: m.date,
          spend: m.spend.toString(),
          impressions: m.impressions,
          clicks: m.clicks,
        });
      }
    }
  }

  await db.insert(schema.integrationCredentials).values({ id: generateId(), tenantId: session.tenantId, integrationId: row.id, encryptedPayload: encryptSecret(JSON.stringify(credentials)) });

  await db
    .update(schema.integrations)
    .set({
      status: "CONNECTED",
      externalAccountId,
      externalAccountName: parsed.data.accountName,
      webhookStatus: null,
      connectedByUserId: session.userId,
      lastSyncAt: new Date(),
    })
    .where(eq(schema.integrations.id, row.id));

  await logAudit({ tenantId: session.tenantId, userId: session.userId, action: "integration.connected", entity: "integration", entityId: row.id, after: { provider: params.provider, externalAccountName: parsed.data.accountName } });

  return jsonOk({ ok: true, externalAccountName: parsed.data.accountName, campaignsSynced: normalizedCampaigns.length });
}
