import { db, schema } from "@/db/client";
import { and, eq, desc } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";

export async function GET() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);

  const [integration] = await db
    .select()
    .from(schema.integrations)
    .where(and(eq(schema.integrations.tenantId, session.tenantId), eq(schema.integrations.provider, "google_search_console")))
    .limit(1);

  if (!integration || integration.status !== "CONNECTED") {
    return jsonOk({ connected: false, snapshots: [], topQueries: [] });
  }

  const snapshots = await db
    .select()
    .from(schema.searchConsoleSnapshots)
    .where(eq(schema.searchConsoleSnapshots.integrationId, integration.id))
    .orderBy(desc(schema.searchConsoleSnapshots.date));

  const totalImpressions = snapshots.reduce((s, r) => s + r.impressions, 0);
  const totalClicks = snapshots.reduce((s, r) => s + r.clicks, 0);
  const avgPosition = snapshots.length ? snapshots.reduce((s, r) => s + Number(r.avgPosition ?? 0), 0) / snapshots.length : 0;

  // Roll up top queries across the whole window rather than just the
  // latest day's snapshot.
  const queryTotals = new Map<string, { clicks: number; impressions: number }>();
  for (const s of snapshots) {
    for (const q of s.topQueries ?? []) {
      const existing = queryTotals.get(q.query) ?? { clicks: 0, impressions: 0 };
      queryTotals.set(q.query, { clicks: existing.clicks + q.clicks, impressions: existing.impressions + q.impressions });
    }
  }
  const topQueries = Array.from(queryTotals.entries())
    .map(([query, v]) => ({ query, ...v }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 8);

  return jsonOk({
    connected: true,
    propertyName: integration.externalAccountName,
    totalImpressions,
    totalClicks,
    avgPosition: Math.round(avgPosition * 10) / 10,
    topQueries,
  });
}
