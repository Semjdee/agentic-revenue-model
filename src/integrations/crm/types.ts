// Common CRM connector interface (spec section 10). Individual connectors
// (HubSpot, Kommo, Salesforce, Zoho, Odoo, custom) implement this interface;
// nothing outside src/integrations/crm/* should contain CRM-specific logic
// (spec: "Do NOT spread CRM-specific logic throughout the application").
export interface CRMContact {
  externalId?: string;
  name?: string;
  email?: string;
  phone?: string;
}
export interface CRMLead {
  externalId?: string;
  contactExternalId: string;
  stage: string;
  source?: string;
}
export interface CRMOpportunity {
  externalId?: string;
  leadExternalId?: string;
  value?: number;
  stage: string;
}
export interface CRMTask {
  externalId?: string;
  title: string;
  dueAt?: string;
}

export interface CRMConnector {
  readonly provider: string;
  readonly isMock: boolean;

  authenticate(credentials: Record<string, unknown>): Promise<{ ok: boolean; message?: string }>;
  testConnection(): Promise<{ ok: boolean; message?: string }>;

  createContact(contact: CRMContact): Promise<{ externalId: string }>;
  updateContact(externalId: string, contact: Partial<CRMContact>): Promise<{ ok: boolean }>;

  createLead(lead: CRMLead): Promise<{ externalId: string }>;
  updateLead(externalId: string, lead: Partial<CRMLead>): Promise<{ ok: boolean }>;

  createOpportunity(opp: CRMOpportunity): Promise<{ externalId: string }>;
  updateOpportunity(externalId: string, opp: Partial<CRMOpportunity>): Promise<{ ok: boolean }>;

  createTask(task: CRMTask): Promise<{ externalId: string }>;
  updateTask(externalId: string, task: Partial<CRMTask>): Promise<{ ok: boolean }>;

  fetchContact(externalId: string): Promise<CRMContact | null>;
  fetchLead(externalId: string): Promise<CRMLead | null>;
  fetchOpportunity(externalId: string): Promise<CRMOpportunity | null>;

  registerWebhooks(callbackUrl: string): Promise<{ ok: boolean }>;
  processWebhook(payload: unknown): Promise<{ ok: boolean; entity?: string }>;
}
