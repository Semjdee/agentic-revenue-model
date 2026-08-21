import { db, schema } from "@/db/client";
import { and, eq, gte } from "drizzle-orm";

// Team performance reporting — Industry Team Subscription Architecture
// doc, Part B. Every number here is a real aggregate over columns that
// already existed before this doc (leads.assignedUserId,
// tasks.assignedUserId, opportunities.owner) — nothing new to capture,
// just never aggregated per-user before. Same join/aggregation shape as
// modules/platform/ai-economics.ts's computeAiEconomics().
//
// Deliberately does NOT include an "avg response time" metric — that
// would need per-message timestamps (messages table), a real but
// separately-scoped addition; every metric below is one this file can
// compute honestly from existing rows today.

export interface TeamMemberPerformance {
  userId: string;
  name: string;
  leadsAssigned: number;
  leadsContacted: number; // progressed beyond NEW
  opportunities: number;
  wonOpportunities: number;
  wonRevenue: number;
  conversionPct: number | null;
  avgDealSize: number | null;
  avgSalesCycleDays: number | null;
  followUpAttempts: number;
  tasksCompleted: number;
  tasksOpen: number;
}

export async function computeTeamPerformance(tenantId: string, days = 30): Promise<TeamMemberPerformance[]> {
  const since = new Date(Date.now() - days * 86400000);

  const users = await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(eq(schema.users.tenantId, tenantId));
  if (users.length === 0) return [];
  const userIds = users.map((u) => u.id);

  const [leadsAll, opportunitiesAll, tasksAll, salesAll] = await Promise.all([
    db.select().from(schema.leads).where(and(eq(schema.leads.tenantId, tenantId), gte(schema.leads.createdAt, since))),
    db.select().from(schema.opportunities).where(and(eq(schema.opportunities.tenantId, tenantId), gte(schema.opportunities.createdAt, since))),
    db.select().from(schema.tasks).where(eq(schema.tasks.tenantId, tenantId)),
    db.select().from(schema.sales).where(eq(schema.sales.tenantId, tenantId)),
  ]);

  const opportunityById = new Map(opportunitiesAll.map((o) => [o.id, o]));
  const salesByOwner = new Map<string, { revenue: number; count: number; cycleDaysSum: number; cycleDaysCount: number }>();
  for (const sale of salesAll) {
    const opp = opportunityById.get(sale.opportunityId);
    if (!opp || !opp.owner || !userIds.includes(opp.owner)) continue;
    const entry = salesByOwner.get(opp.owner) ?? { revenue: 0, count: 0, cycleDaysSum: 0, cycleDaysCount: 0 };
    entry.revenue += Number(sale.amount);
    entry.count += 1;
    const cycleDays = (sale.closedAt.getTime() - opp.createdAt.getTime()) / 86400000;
    if (cycleDays >= 0) {
      entry.cycleDaysSum += cycleDays;
      entry.cycleDaysCount += 1;
    }
    salesByOwner.set(opp.owner, entry);
  }

  return users.map((u) => {
    const myLeads = leadsAll.filter((l) => l.assignedUserId === u.id);
    const myOpportunities = opportunitiesAll.filter((o) => o.owner === u.id);
    const myTasks = tasksAll.filter((t) => t.assignedUserId === u.id);
    const won = myOpportunities.filter((o) => o.stage === "WON");
    const sale = salesByOwner.get(u.id);

    return {
      userId: u.id,
      name: u.name,
      leadsAssigned: myLeads.length,
      leadsContacted: myLeads.filter((l) => l.stage !== "NEW").length,
      opportunities: myOpportunities.length,
      wonOpportunities: won.length,
      wonRevenue: sale?.revenue ?? 0,
      conversionPct: myOpportunities.length > 0 ? (won.length / myOpportunities.length) * 100 : null,
      avgDealSize: sale && sale.count > 0 ? sale.revenue / sale.count : null,
      avgSalesCycleDays: sale && sale.cycleDaysCount > 0 ? sale.cycleDaysSum / sale.cycleDaysCount : null,
      followUpAttempts: myOpportunities.reduce((s, o) => s + o.followUpAttempts, 0),
      tasksCompleted: myTasks.filter((t) => t.status === "DONE").length,
      tasksOpen: myTasks.filter((t) => t.status === "OPEN").length,
    };
  });
}
