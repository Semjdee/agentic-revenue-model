import { db, schema } from "@/db/client";
import { and, eq } from "drizzle-orm";
import { generateId } from "@/lib/ids";
import { getCRMConnector } from "@/integrations/crm/mock-connector";

// ============================================================================
// CRM push-out sync (spec section 10).
//
// A tenant can connect a CRM (HubSpot/Kommo/Salesforce/Zoho/Odoo — see
// src/app/api/internal/integrations/crm/[provider]/connect/route.ts) and
// the full CRMConnector interface + DEMO/MOCK connector have existed since
// that flow was built (src/integrations/crm/mock-connector.ts), along with
// an `external_mappings` table and an `opportunities.crm_sync_status`
// column meant for exactly this — but nothing ever actually called
// createLead/createOpportunity/etc. Connecting a CRM did nothing beyond
// flip a status pill. This module is what actually pushes contact/lead/
// opportunity writes out, wired in from src/modules/ai/actions.ts right
// after each entity is written locally.
//
// The connect flow doesn't stop a tenant from connecting more than one CRM
// provider at once (e.g. mid-migration between two), so this fans out to
// EVERY connected CRM rather than picking one arbitrarily — an earlier
// version here queried `.limit(1)` with no ordering, which silently
// alternated between providers across calls when two were connected
// (verified live: it split one contact's mapping across two CRMs — see
// external_mappings ending up with two rows for the same contact, one per
// provider). Each provider gets its own external_mappings row keyed by
// (tenant, entity, provider), so this is correct even with several
// providers connected simultaneously.
//
// Best-effort by design: a CRM sync failure (mock or, later, a real
// provider being briefly unreachable) must never block or roll back the
// core AI action — the lead/opportunity is already real in our own
// database regardless of what a downstream CRM does with it. Errors are
// logged with the real provider name and error, never swallowed silently
// and never reported as success.
// ============================================================================

const ENTITY_TYPES = { CONTACT: "CONTACT", LEAD: "LEAD", OPPORTUNITY: "OPPORTUNITY" } as const;

async function getConnectedCrms(tenantId: string) {
  return db
    .select()
    .from(schema.integrations)
    .where(and(eq(schema.integrations.tenantId, tenantId), eq(schema.integrations.category, "CRM"), eq(schema.integrations.status, "CONNECTED")));
}

async function getMapping(tenantId: string, entityType: string, entityId: string, integration: string) {
  const [row] = await db
    .select()
    .from(schema.externalMappings)
    .where(
      and(
        eq(schema.externalMappings.tenantId, tenantId),
        eq(schema.externalMappings.internalEntityType, entityType),
        eq(schema.externalMappings.internalEntityId, entityId),
        eq(schema.externalMappings.integration, integration)
      )
    )
    .limit(1);
  return row?.externalEntityId ?? null;
}

async function saveMapping(tenantId: string, entityType: string, entityId: string, integration: string, externalEntityId: string) {
  await db.insert(schema.externalMappings).values({
    id: generateId(),
    tenantId,
    internalEntityType: entityType,
    internalEntityId: entityId,
    integration,
    externalEntityId,
  });
}

async function touchLastSync(integrationId: string) {
  await db.update(schema.integrations).set({ lastSyncAt: new Date() }).where(eq(schema.integrations.id, integrationId));
}

/** Push a contact create/update to every CRM the tenant has connected. Returns the external id per provider (empty object if none connected or nothing succeeded). */
export async function syncContactToCrm(tenantId: string, contactId: string): Promise<Record<string, string>> {
  const integrations = await getConnectedCrms(tenantId);
  if (!integrations.length) return {};

  const [contact] = await db.select().from(schema.contacts).where(and(eq(schema.contacts.id, contactId), eq(schema.contacts.tenantId, tenantId))).limit(1);
  if (!contact) return {};

  const results: Record<string, string> = {};
  for (const integration of integrations) {
    const connector = getCRMConnector(integration.provider);
    const existingExternalId = await getMapping(tenantId, ENTITY_TYPES.CONTACT, contactId, integration.provider);
    try {
      const patch = { name: contact.name ?? undefined, email: contact.email ?? undefined, phone: contact.phone ?? undefined };
      if (existingExternalId) {
        await connector.updateContact(existingExternalId, patch);
        results[integration.provider] = existingExternalId;
      } else {
        const { externalId } = await connector.createContact(patch);
        await saveMapping(tenantId, ENTITY_TYPES.CONTACT, contactId, integration.provider, externalId);
        results[integration.provider] = externalId;
      }
      await touchLastSync(integration.id);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[crm-sync] contact push failed (provider=${integration.provider}, contactId=${contactId}):`, err);
    }
  }
  return results;
}

/** Push a lead create/update to every CRM the tenant has connected. */
export async function syncLeadToCrm(tenantId: string, leadId: string): Promise<Record<string, string>> {
  const integrations = await getConnectedCrms(tenantId);
  if (!integrations.length) return {};

  const [lead] = await db.select().from(schema.leads).where(and(eq(schema.leads.id, leadId), eq(schema.leads.tenantId, tenantId))).limit(1);
  if (!lead) return {};

  // A lead's CRM record needs its contact's external id first — push the
  // contact through the same connectors/mappings if it isn't synced yet.
  const contactExternalIds = await syncContactToCrm(tenantId, lead.contactId);

  const results: Record<string, string> = {};
  for (const integration of integrations) {
    const contactExternalId = contactExternalIds[integration.provider];
    if (!contactExternalId) continue; // contact push failed for this provider — skip the dependent lead push too

    const connector = getCRMConnector(integration.provider);
    const existingExternalId = await getMapping(tenantId, ENTITY_TYPES.LEAD, leadId, integration.provider);
    try {
      const patch = { contactExternalId, stage: lead.stage, source: lead.source ?? undefined };
      if (existingExternalId) {
        await connector.updateLead(existingExternalId, patch);
        results[integration.provider] = existingExternalId;
      } else {
        const { externalId } = await connector.createLead(patch);
        await saveMapping(tenantId, ENTITY_TYPES.LEAD, leadId, integration.provider, externalId);
        results[integration.provider] = externalId;
      }
      await touchLastSync(integration.id);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[crm-sync] lead push failed (provider=${integration.provider}, leadId=${leadId}):`, err);
    }
  }
  return results;
}

/** Push an opportunity create/update to every CRM the tenant has connected. Updates opportunities.crmSyncStatus with the real aggregate outcome. */
export async function syncOpportunityToCrm(tenantId: string, opportunityId: string): Promise<Record<string, string>> {
  const integrations = await getConnectedCrms(tenantId);
  if (!integrations.length) return {};

  const [opp] = await db.select().from(schema.opportunities).where(and(eq(schema.opportunities.id, opportunityId), eq(schema.opportunities.tenantId, tenantId))).limit(1);
  if (!opp) return {};

  const leadExternalIds = opp.leadId ? await syncLeadToCrm(tenantId, opp.leadId) : {};

  const results: Record<string, string> = {};
  for (const integration of integrations) {
    const connector = getCRMConnector(integration.provider);
    const existingExternalId = await getMapping(tenantId, ENTITY_TYPES.OPPORTUNITY, opportunityId, integration.provider);
    try {
      const patch = {
        leadExternalId: leadExternalIds[integration.provider] ?? undefined,
        value: opp.estimatedValue ? Number(opp.estimatedValue) : undefined,
        stage: opp.stage,
      };
      if (existingExternalId) {
        await connector.updateOpportunity(existingExternalId, patch);
        results[integration.provider] = existingExternalId;
      } else {
        const created = await connector.createOpportunity(patch);
        await saveMapping(tenantId, ENTITY_TYPES.OPPORTUNITY, opportunityId, integration.provider, created.externalId);
        results[integration.provider] = created.externalId;
      }
      await touchLastSync(integration.id);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[crm-sync] opportunity push failed (provider=${integration.provider}, opportunityId=${opportunityId}):`, err);
    }
  }

  const status = Object.keys(results).length === integrations.length ? "SYNCED" : Object.keys(results).length > 0 ? "PARTIAL" : "FAILED";
  await db.update(schema.opportunities).set({ crmSyncStatus: status }).where(eq(schema.opportunities.id, opportunityId));
  return results;
}
