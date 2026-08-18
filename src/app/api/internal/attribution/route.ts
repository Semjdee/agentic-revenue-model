import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";

// Answers the spec section 12 questions: which campaign generated this
// customer / this sale, and how much revenue came from each source.
export async function GET() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);

  const touches = await db.select().from(schema.attributionTouches).where(eq(schema.attributionTouches.tenantId, session.tenantId));
  const sales = await db.select().from(schema.sales).where(eq(schema.sales.tenantId, session.tenantId));
  const salesById = new Map(sales.map((s) => [s.id, s]));

  const revenueBySource: Record<string, number> = {};
  const revenueByCampaign: Record<string, number> = {};
  for (const t of touches) {
    if (t.touchType !== "LAST" || !t.saleId) continue;
    const sale = salesById.get(t.saleId);
    if (!sale) continue;
    const source = t.source || "direct";
    const campaign = t.campaign || "(uncategorized)";
    revenueBySource[source] = (revenueBySource[source] ?? 0) + Number(sale.amount);
    revenueByCampaign[campaign] = (revenueByCampaign[campaign] ?? 0) + Number(sale.amount);
  }

  return jsonOk({
    touches,
    revenueBySource: Object.entries(revenueBySource).map(([source, revenue]) => ({ source, revenue })),
    revenueByCampaign: Object.entries(revenueByCampaign).map(([campaign, revenue]) => ({ campaign, revenue })),
  });
}
