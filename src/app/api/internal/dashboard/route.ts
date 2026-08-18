import { NextRequest } from "next/server";
import { db, schema } from "@/db/client";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";

function rangeFromQuery(req: NextRequest): { from: Date; to: Date } {
  const range = req.nextUrl.searchParams.get("range") || "7d";
  const now = new Date();
  const to = now;
  if (range === "today") return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate()), to };
  if (range === "yesterday") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { from: start, to: end };
  }
  if (range === "30d") return { from: new Date(now.getTime() - 30 * 86400000), to };
  if (range === "custom") {
    const from = req.nextUrl.searchParams.get("from");
    const toParam = req.nextUrl.searchParams.get("to");
    return { from: from ? new Date(from) : new Date(now.getTime() - 7 * 86400000), to: toParam ? new Date(toParam) : to };
  }
  return { from: new Date(now.getTime() - 7 * 86400000), to };
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  const { from, to } = rangeFromQuery(req);
  const tenantId = session.tenantId;

  const [{ conversations }] = await db
    .select({ conversations: sql<number>`count(*)` })
    .from(schema.conversations)
    .where(and(eq(schema.conversations.tenantId, tenantId), gte(schema.conversations.createdAt, from), lte(schema.conversations.createdAt, to)));

  const [{ qualifiedLeads }] = await db
    .select({ qualifiedLeads: sql<number>`count(*)` })
    .from(schema.leads)
    .where(and(eq(schema.leads.tenantId, tenantId), sql`${schema.leads.stage} in ('QUALIFIED','OPPORTUNITY','QUOTATION','WON')`, gte(schema.leads.createdAt, from), lte(schema.leads.createdAt, to)));

  const salesRows = await db
    .select()
    .from(schema.sales)
    .where(and(eq(schema.sales.tenantId, tenantId), gte(schema.sales.closedAt, from), lte(schema.sales.closedAt, to)));
  const revenue = salesRows.reduce((s, r) => s + Number(r.amount), 0);

  const revenueByDay = new Map<string, number>();
  for (const s of salesRows) {
    const day = s.closedAt.toISOString().slice(0, 10);
    revenueByDay.set(day, (revenueByDay.get(day) ?? 0) + Number(s.amount));
  }
  const revenueSeries = Array.from(revenueByDay.entries())
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const adSnapshots = await db
    .select()
    .from(schema.adMetricSnapshots)
    .where(and(eq(schema.adMetricSnapshots.tenantId, tenantId), gte(schema.adMetricSnapshots.date, from.toISOString().slice(0, 10)), lte(schema.adMetricSnapshots.date, to.toISOString().slice(0, 10))));
  const adSpend = adSnapshots.reduce((s, r) => s + Number(r.spend), 0);

  const [{ aiHandled }] = await db
    .select({ aiHandled: sql<number>`count(*) filter (where ${schema.conversations.aiActive} = true)` })
    .from(schema.conversations)
    .where(and(eq(schema.conversations.tenantId, tenantId), gte(schema.conversations.createdAt, from), lte(schema.conversations.createdAt, to)));
  const [{ humanHandled }] = await db
    .select({ humanHandled: sql<number>`count(*) filter (where ${schema.conversations.aiActive} = false)` })
    .from(schema.conversations)
    .where(and(eq(schema.conversations.tenantId, tenantId), gte(schema.conversations.createdAt, from), lte(schema.conversations.createdAt, to)));

  // Lead funnel
  const funnelStages = ["NEW", "QUALIFIED", "QUOTATION", "WON"] as const;
  const funnel: Record<string, number> = {};
  for (const stage of funnelStages) {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.leads)
      .where(and(eq(schema.leads.tenantId, tenantId), eq(schema.leads.stage, stage)));
    funnel[stage] = Number(count);
  }

  // Channel performance
  const channelRows = await db
    .select({ channel: schema.conversations.channel, count: sql<number>`count(*)` })
    .from(schema.conversations)
    .where(eq(schema.conversations.tenantId, tenantId))
    .groupBy(schema.conversations.channel);

  // Traffic source performance
  const sourceRows = await db
    .select({ source: schema.conversations.utmSource, count: sql<number>`count(*)` })
    .from(schema.conversations)
    .where(eq(schema.conversations.tenantId, tenantId))
    .groupBy(schema.conversations.utmSource);

  // Needs attention
  const now = new Date();
  const overdueFollowUps = await db
    .select()
    .from(schema.opportunities)
    .where(and(eq(schema.opportunities.tenantId, tenantId), lte(schema.opportunities.nextFollowUpAt, now)));
  const hotLeads = await db
    .select()
    .from(schema.leads)
    .where(and(eq(schema.leads.tenantId, tenantId), sql`${schema.leads.score} >= 60`, eq(schema.leads.stage, "QUALIFIED")));
  const pendingRecommendations = await db
    .select()
    .from(schema.advertisingRecommendations)
    .where(and(eq(schema.advertisingRecommendations.tenantId, tenantId), eq(schema.advertisingRecommendations.status, "NEW")));
  const failedWebhooks = await db
    .select()
    .from(schema.webhookDeliveries)
    .where(and(eq(schema.webhookDeliveries.tenantId, tenantId), eq(schema.webhookDeliveries.status, "FAILED")));

  const cpl = Number(qualifiedLeads) > 0 ? adSpend / Number(qualifiedLeads) : 0;
  const cps = salesRows.length > 0 ? adSpend / salesRows.length : 0;
  const roas = adSpend > 0 ? revenue / adSpend : 0;

  return jsonOk({
    range: { from, to },
    revenueSeries,
    kpis: {
      conversations: Number(conversations),
      qualifiedLeads: Number(qualifiedLeads),
      sales: salesRows.length,
      revenue,
      advertisingSpend: adSpend,
      costPerLead: cpl,
      costPerSale: cps,
      roas,
      aiHandled: Number(aiHandled),
      humanHandled: Number(humanHandled),
    },
    funnel,
    channelPerformance: channelRows,
    trafficSourcePerformance: sourceRows,
    needsAttention: {
      overdueFollowUps: overdueFollowUps.length,
      hotLeads: hotLeads.length,
      pendingRecommendations: pendingRecommendations.length,
      failedWebhooks: failedWebhooks.length,
    },
  });
}
