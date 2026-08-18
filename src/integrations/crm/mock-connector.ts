import { randomUUID } from "crypto";
import type { CRMConnector, CRMContact, CRMLead, CRMOpportunity, CRMTask } from "./types";

/**
 * DEMO / MOCK CONNECTOR (spec section 37: "If external credentials/API
 * approval are unavailable, build the complete connector abstraction and
 * provide a clearly labelled DEMO/MOCK CONNECTOR ... Do not pretend real API
 * actions occurred.").
 *
 * This implements the full CRMConnector interface with an in-memory store
 * so the Integration Hub / sync flows are testable end-to-end without real
 * HubSpot/Kommo/Salesforce/Zoho/Odoo credentials. Every method result is
 * tagged `isMock: true` and nothing here calls a real external API.
 */
export class MockCRMConnector implements CRMConnector {
  readonly isMock = true;
  private store = { contacts: new Map<string, CRMContact>(), leads: new Map<string, CRMLead>(), opps: new Map<string, CRMOpportunity>() };

  constructor(public readonly provider: string) {}

  async authenticate() {
    return { ok: true, message: `[MOCK] ${this.provider} authentication simulated — no real credentials used.` };
  }
  async testConnection() {
    return { ok: true, message: `[MOCK] ${this.provider} connection simulated.` };
  }
  async createContact(contact: CRMContact) {
    const externalId = "mock_contact_" + randomUUID().slice(0, 8);
    this.store.contacts.set(externalId, { ...contact, externalId });
    return { externalId };
  }
  async updateContact(externalId: string, patch: Partial<CRMContact>) {
    const existing = this.store.contacts.get(externalId);
    if (existing) this.store.contacts.set(externalId, { ...existing, ...patch });
    return { ok: true };
  }
  async createLead(lead: CRMLead) {
    const externalId = "mock_lead_" + randomUUID().slice(0, 8);
    this.store.leads.set(externalId, { ...lead, externalId });
    return { externalId };
  }
  async updateLead(externalId: string, patch: Partial<CRMLead>) {
    const existing = this.store.leads.get(externalId);
    if (existing) this.store.leads.set(externalId, { ...existing, ...patch });
    return { ok: true };
  }
  async createOpportunity(opp: CRMOpportunity) {
    const externalId = "mock_opp_" + randomUUID().slice(0, 8);
    this.store.opps.set(externalId, { ...opp, externalId });
    return { externalId };
  }
  async updateOpportunity(externalId: string, patch: Partial<CRMOpportunity>) {
    const existing = this.store.opps.get(externalId);
    if (existing) this.store.opps.set(externalId, { ...existing, ...patch });
    return { ok: true };
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- interface parameter kept for signature parity with a real connector implementation
  async createTask(_task: CRMTask) {
    return { externalId: "mock_task_" + randomUUID().slice(0, 8) };
  }
  async updateTask() {
    return { ok: true };
  }
  async fetchContact(externalId: string) {
    return this.store.contacts.get(externalId) ?? null;
  }
  async fetchLead(externalId: string) {
    return this.store.leads.get(externalId) ?? null;
  }
  async fetchOpportunity(externalId: string) {
    return this.store.opps.get(externalId) ?? null;
  }
  async registerWebhooks() {
    return { ok: true };
  }
  async processWebhook() {
    return { ok: true };
  }
}

export function getCRMConnector(provider: string): CRMConnector {
  // Real connectors (HubSpotConnector, KommoConnector, ...) would be added
  // here behind the same interface once API credentials are available.
  return new MockCRMConnector(provider);
}
