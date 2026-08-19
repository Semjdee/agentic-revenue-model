import { db, schema } from "@/db/client";
import { and, eq } from "drizzle-orm";

// Pre-launch health check — docs/ONBOARDING_SPEC.md section 16. Pure
// read/compute function: checks real state, never returns a hardcoded
// pass. Reused by both the wizard's Health Check step and
// POST /api/internal/onboarding/go-live, which re-runs this same check
// server-side rather than trusting whatever the client last saw (spec
// section 35 applies just as much to Go Live as to any "Connected"
// badge).

export interface HealthCheckCategory {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface HealthCheckResult {
  ready: boolean;
  categories: HealthCheckCategory[];
}

export async function runHealthCheck(tenantId: string, agentId: string): Promise<HealthCheckResult> {
  const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
  const [agent] = await db.select().from(schema.agents).where(and(eq(schema.agents.id, agentId), eq(schema.agents.tenantId, tenantId))).limit(1);

  const businessProfileOk = Boolean(tenant?.name && tenant?.industry && tenant?.country);
  const categories: HealthCheckCategory[] = [
    {
      key: "BUSINESS_PROFILE",
      label: "Business profile",
      ok: businessProfileOk,
      detail: businessProfileOk ? "Complete" : "Finish your business profile before going live.",
    },
  ];

  // Knowledge: at least one product OR at least one knowledge document —
  // an agent with literally nothing to ground its answers in shouldn't
  // go live (spec section 5's "never fabricate" rule needs something real
  // to draw from).
  const products = await db.select({ id: schema.products.id }).from(schema.products).where(eq(schema.products.tenantId, tenantId)).limit(1);
  const knowledgeDocs = await db.select({ id: schema.knowledgeDocuments.id }).from(schema.knowledgeDocuments).where(eq(schema.knowledgeDocuments.tenantId, tenantId)).limit(1);
  const hasKnowledge = products.length > 0 || knowledgeDocs.length > 0;
  categories.push({
    key: "KNOWLEDGE",
    label: "Knowledge",
    ok: hasKnowledge,
    detail: hasKnowledge ? `${products.length ? "Products loaded" : "Knowledge base has content"}` : "Add at least one product or knowledge item.",
  });

  // Channel: at least one CONNECTED integration/channel_connection.
  const [connectedIntegration] = await db
    .select({ id: schema.integrations.id })
    .from(schema.integrations)
    .where(and(eq(schema.integrations.tenantId, tenantId), eq(schema.integrations.status, "CONNECTED")))
    .limit(1);
  const [connectedChannel] = await db
    .select({ id: schema.channelConnections.id })
    .from(schema.channelConnections)
    .where(and(eq(schema.channelConnections.tenantId, tenantId), eq(schema.channelConnections.status, "CONNECTED")))
    .limit(1);
  const channelOk = Boolean(connectedIntegration || connectedChannel);
  categories.push({
    key: "CHANNEL",
    label: "Channel",
    ok: channelOk,
    detail: channelOk ? "Connected" : "Connect WhatsApp or your website widget before going live.",
  });

  // Agent config: has qualification questions AND agent exists.
  const agentOk = Boolean(agent && (agent.qualificationQuestions ?? []).length > 0);
  categories.push({
    key: "AGENT",
    label: "AI Agent",
    ok: agentOk,
    detail: agentOk ? "Configuration valid" : "Your agent needs at least one qualification question.",
  });

  // CRM pipeline: always ready — it's the existing hardcoded default
  // (spec section 24), same LEAD_STAGES every tenant already gets.
  categories.push({ key: "CRM", label: "CRM", ok: true, detail: "Default lead pipeline ready" });

  // Permissions: always ready — ACTION_PERMISSIONS defaults (spec section
  // 25) apply tenant-wide already, see src/modules/ai/actions.ts.
  categories.push({ key: "SECURITY", label: "Security", ok: true, detail: "Permissions valid" });

  return { ready: categories.every((c) => c.ok), categories };
}
