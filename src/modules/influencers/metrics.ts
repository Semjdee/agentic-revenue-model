import { db, schema } from "@/db/client";
import { and, eq, inArray } from "drizzle-orm";

// ============================================================================
// Deterministic influencer commercial metrics (docs/PHASE_2_TASKS.md
// Milestone 6, spec section 26). Pure computation from real data this app
// already owns — clicks (referral_clicks), conversations/leads/sales
// (joined via conversations.influencerId and attribution_touches, both
// set at conversation-creation time — see modules/conversations/
// engine.ts's startChannelConversation `referral` param), and manually
// entered costs (influencer_costs). NO LLM call in this file — same
// discipline as computeCampaignPerformance in
// modules/advertising/analyst.ts. The AI Influencer Analyst
// (modules/influencers/analyst.ts) only ever explains numbers computed
// here; it never invents them.
// ============================================================================

export interface InfluencerMetrics {
  influencerId: string;
  clicks: number;
  conversationsStarted: number;
  clickToConversationRate: number; // 0-1
  leads: number;
  qualifiedLeads: number;
  opportunities: number;
  sales: number;
  revenue: number;
  aov: number; // average order value
  leadToSaleRate: number; // 0-1
  cost: number;
  cpl: number; // cost per lead
  costPerQualifiedLead: number;
  costPerSale: number;
  roas: number; // revenue / cost
  roi: number; // (revenue - cost) / cost
}

export async function computeInfluencerMetrics(tenantId: string, influencerId: string): Promise<InfluencerMetrics> {
  const links = await db.select().from(schema.trackingLinks).where(and(eq(schema.trackingLinks.tenantId, tenantId), eq(schema.trackingLinks.influencerId, influencerId)));
  const linkIds = links.map((l) => l.id);

  const clicks = linkIds.length
    ? (await db.select().from(schema.referralClicks).where(inArray(schema.referralClicks.trackingLinkId, linkIds))).length
    : 0;

  const conversations = await db
    .select()
    .from(schema.conversations)
    .where(and(eq(schema.conversations.tenantId, tenantId), eq(schema.conversations.influencerId, influencerId)));
  const conversationIds = new Set(conversations.map((c) => c.id));

  const allLeads = conversationIds.size ? await db.select().from(schema.leads).where(eq(schema.leads.tenantId, tenantId)) : [];
  const matchingLeads = allLeads.filter((l) => l.conversationId && conversationIds.has(l.conversationId));
  const qualifiedLeads = matchingLeads.filter((l) => ["QUALIFIED", "OPPORTUNITY", "QUOTATION", "WON"].includes(l.stage)).length;

  const attributedTouches = await db
    .select()
    .from(schema.attributionTouches)
    .where(and(eq(schema.attributionTouches.tenantId, tenantId), eq(schema.attributionTouches.touchType, "LAST"), eq(schema.attributionTouches.influencerId, influencerId)));
  const saleIds = attributedTouches.map((t) => t.saleId).filter((id): id is string => !!id);
  const opportunityIds = new Set(attributedTouches.map((t) => t.opportunityId).filter((id): id is string => !!id));
  const matchingSales = saleIds.length ? await db.select().from(schema.sales).where(inArray(schema.sales.id, saleIds)) : [];
  const revenue = matchingSales.reduce((s, r) => s + Number(r.amount), 0);

  const costRows = await db.select().from(schema.influencerCosts).where(and(eq(schema.influencerCosts.tenantId, tenantId), eq(schema.influencerCosts.influencerId, influencerId)));
  const cost = costRows.reduce((s, r) => s + Number(r.amount), 0);

  const leadsCount = matchingLeads.length;
  const salesCount = matchingSales.length;

  return {
    influencerId,
    clicks,
    conversationsStarted: conversations.length,
    clickToConversationRate: clicks > 0 ? conversations.length / clicks : 0,
    leads: leadsCount,
    qualifiedLeads,
    opportunities: opportunityIds.size,
    sales: salesCount,
    revenue,
    aov: salesCount > 0 ? revenue / salesCount : 0,
    leadToSaleRate: leadsCount > 0 ? salesCount / leadsCount : 0,
    cost,
    cpl: leadsCount > 0 ? cost / leadsCount : 0,
    costPerQualifiedLead: qualifiedLeads > 0 ? cost / qualifiedLeads : 0,
    costPerSale: salesCount > 0 ? cost / salesCount : 0,
    roas: cost > 0 ? revenue / cost : 0,
    roi: cost > 0 ? (revenue - cost) / cost : 0,
  };
}

export async function computeAllInfluencerMetrics(tenantId: string): Promise<InfluencerMetrics[]> {
  const rows = await db.select().from(schema.influencers).where(eq(schema.influencers.tenantId, tenantId));
  return Promise.all(rows.map((r) => computeInfluencerMetrics(tenantId, r.id)));
}
