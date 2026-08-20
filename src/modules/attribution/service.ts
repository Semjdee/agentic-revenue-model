import { db, schema } from "@/db/client";
import { generateId } from "@/lib/ids";
import { eq, and } from "drizzle-orm";
import { logOnboardingEventOnce } from "@/modules/onboarding/service";

// ============================================================================
// Attribution Engine (spec section 12).
//
// Two things happen here, deliberately kept separate:
//
//   1. recordConversationTouch() — called the moment ANY conversation is
//      created (website widget, WhatsApp, Instagram), regardless of
//      whether it ever becomes a lead/opportunity/sale. This is the
//      COMPLETE touch history: every contact interaction gets a durable
//      attribution_touches row (touchType "TOUCH") as it happens, not
//      retroactively. Without this, a contact who messaged three times
//      before buying only ever had 2 touches recoverable (whichever
//      conversations happened to be first/latest on the opportunity) —
//      everything in between was gone. Necessary groundwork for
//      assisted/multi-touch attribution later; not itself a new
//      attribution MODEL (see markFirstLastTouch below — that's
//      unchanged).
//
//   2. computeAttributionForOpportunity() — the existing first/last-touch
//      MODEL (spec section 12), which promotes two specific touches
//      (touchType "FIRST"/"LAST") once an opportunity exists, linking
//      leadId/opportunityId/saleId. Reporting (revenue by source/
//      campaign on the Attribution page) reads these two types
//      specifically — left untouched so that page's behavior doesn't
//      change. "TOUCH" rows are additive alongside them, for future use.
// ============================================================================

export async function recordTrafficSession(params: {
  tenantId: string;
  sessionId: string;
  contactId?: string | null;
  firstLandingPage?: string;
  referringUrl?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  gclid?: string;
  fbclid?: string;
}) {
  await db.insert(schema.trafficSessions).values({
    id: generateId(),
    tenantId: params.tenantId,
    sessionId: params.sessionId,
    contactId: params.contactId ?? null,
    firstLandingPage: params.firstLandingPage,
    referringUrl: params.referringUrl,
    utmSource: params.utmSource,
    utmMedium: params.utmMedium,
    utmCampaign: params.utmCampaign,
    utmContent: params.utmContent,
    utmTerm: params.utmTerm,
    gclid: params.gclid,
    fbclid: params.fbclid,
  });
}

function conversationToTouch(conv: typeof schema.conversations.$inferSelect, touchType: "FIRST" | "LAST" | "TOUCH") {
  return {
    id: generateId(),
    tenantId: conv.tenantId,
    sessionId: conv.sessionId,
    contactId: conv.contactId,
    // Channel-aware fallback — a WhatsApp/Instagram conversation with no
    // UTM data is a real, known-source touch ("whatsapp"/"instagram"),
    // not an unattributed "direct" visit; "direct" is now reserved for
    // an actual unattributed website visit.
    source: conv.utmSource ?? (conv.gclid ? "google" : conv.fbclid ? "meta" : conv.channel !== "WEBSITE" ? conv.channel.toLowerCase() : "direct"),
    medium: conv.utmMedium ?? (conv.channel !== "WEBSITE" ? "messaging" : "organic"),
    campaign: conv.utmCampaign ?? null,
    // utm_content conventionally carries the ad/creative identifier.
    adName: conv.utmContent ?? null,
    utm: {
      source: conv.utmSource ?? undefined,
      medium: conv.utmMedium ?? undefined,
      campaign: conv.utmCampaign ?? undefined,
      content: conv.utmContent ?? undefined,
      term: conv.utmTerm ?? undefined,
    },
    clickIds: { gclid: conv.gclid ?? undefined, fbclid: conv.fbclid ?? undefined },
    landingPage: conv.landingPage,
    referringPage: conv.referringUrl,
    touchType,
  };
}

/**
 * Records one durable attribution_touches row for a brand-new
 * conversation — call this once, right after the conversation is
 * inserted, from every conversation-creation path (website widget via
 * startConversation, WhatsApp/Instagram via startChannelConversation —
 * see src/modules/conversations/engine.ts). This is what makes the
 * touch history complete: a contact's every interaction is captured as
 * it happens, not reconstructed later from whichever two conversations
 * happened to be linked to an eventual opportunity.
 */
export async function recordConversationTouch(conv: typeof schema.conversations.$inferSelect) {
  await db.insert(schema.attributionTouches).values(conversationToTouch(conv, "TOUCH"));
}

/**
 * Compute and persist FIRST + LAST touch attribution for an opportunity,
 * optionally linking a saleId once the deal is WON. Safe to call multiple
 * times (e.g. re-run when the opportunity's latestConversationId changes).
 */
export async function computeAttributionForOpportunity(opportunityId: string, saleId?: string) {
  const [opp] = await db.select().from(schema.opportunities).where(eq(schema.opportunities.id, opportunityId)).limit(1);
  if (!opp) return;

  const firstConvId = opp.firstConversationId ?? opp.latestConversationId;
  const lastConvId = opp.latestConversationId ?? opp.firstConversationId;
  if (!firstConvId) return;

  const [firstConv] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, firstConvId)).limit(1);
  const [lastConv] = lastConvId
    ? await db.select().from(schema.conversations).where(eq(schema.conversations.id, lastConvId)).limit(1)
    : [firstConv];

  const rows = [];
  if (firstConv) rows.push({ ...conversationToTouch(firstConv, "FIRST"), leadId: opp.leadId, opportunityId: opp.id, saleId: saleId ?? null });
  if (lastConv) rows.push({ ...conversationToTouch(lastConv, "LAST"), leadId: opp.leadId, opportunityId: opp.id, saleId: saleId ?? null });

  if (rows.length) {
    await db.insert(schema.attributionTouches).values(rows);
    if (saleId) {
      await logOnboardingEventOnce(opp.tenantId, "first_attributed_sale", { saleId, opportunityId: opp.id });
    }
  }
}

// ============================================================================
// Assisted attribution (docs backlog: "Assisted/Multi-touch attribution").
//
// FIRST/LAST touch (above) only ever credits the opening and closing
// interaction of a deal — a contact who saw an Instagram ad, later clicked
// a Google search ad, then converted via a WhatsApp chat shows 100% of the
// credit on WhatsApp and Instagram, with the Google touch invisible even
// though it was part of the path. This is the standard "assisted
// conversions" report (the same shape GA/GA4 popularized): for every WON
// sale, walk the contact's COMPLETE touch history up to the moment of
// conversion (recordConversationTouch() is what makes that complete
// history exist at all — every "TOUCH" row, not just FIRST/LAST) and
// credit every source that appeared along the path, distinguishing the
// closing touch from the touches that merely assisted.
//
// Deliberately the simpler binary "did this channel appear in the path"
// model rather than fractional multi-touch weighting (linear/time-decay/
// algorithmic) — the module docblock above already earmarks those as a
// meaningfully bigger, later step; this is the well-understood classic
// report, computed on demand rather than stored (same pattern as
// generateAdvertisingRecommendations/computeCampaignPerformance).
// ============================================================================

export interface AssistedAttributionRow {
  source: string;
  closedConversions: number;
  closedRevenue: number;
  assistedConversions: number;
  assistedRevenue: number;
}

export async function computeAssistedAttribution(tenantId: string): Promise<AssistedAttributionRow[]> {
  const lastTouches = await db
    .select()
    .from(schema.attributionTouches)
    .where(and(eq(schema.attributionTouches.tenantId, tenantId), eq(schema.attributionTouches.touchType, "LAST")));
  const conversions = lastTouches.filter((t) => t.saleId && t.contactId);
  if (!conversions.length) return [];

  const sales = await db.select().from(schema.sales).where(eq(schema.sales.tenantId, tenantId));
  const saleAmountById = new Map(sales.map((s) => [s.id, Number(s.amount)]));

  const allTouches = await db
    .select()
    .from(schema.attributionTouches)
    .where(and(eq(schema.attributionTouches.tenantId, tenantId), eq(schema.attributionTouches.touchType, "TOUCH")));
  const touchesByContact = new Map<string, (typeof allTouches)[number][]>();
  for (const t of allTouches) {
    if (!t.contactId) continue;
    const list = touchesByContact.get(t.contactId) ?? [];
    list.push(t);
    touchesByContact.set(t.contactId, list);
  }

  const bySource = new Map<string, AssistedAttributionRow>();
  const rowFor = (source: string) => {
    let row = bySource.get(source);
    if (!row) {
      row = { source, closedConversions: 0, closedRevenue: 0, assistedConversions: 0, assistedRevenue: 0 };
      bySource.set(source, row);
    }
    return row;
  };

  for (const conv of conversions) {
    const revenue = saleAmountById.get(conv.saleId!) ?? 0;
    const journey = (touchesByContact.get(conv.contactId!) ?? [])
      .filter((t) => new Date(t.createdAt).getTime() <= new Date(conv.createdAt).getTime())
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    // The chronologically last touch up to conversion is the closer —
    // prefer it over the promoted LAST row's own source in the rare case
    // they disagree (e.g. the LAST row was computed before a later touch
    // in the same session landed), since it reflects the actual path.
    const closer = journey[journey.length - 1];
    const closingSource = closer?.source || conv.source || "direct";
    rowFor(closingSource).closedConversions += 1;
    rowFor(closingSource).closedRevenue += revenue;

    // Every OTHER source that appeared earlier in the path gets assist
    // credit — once per conversion per source, not once per touch, so a
    // channel touched twice pre-conversion still counts as one assist
    // (the standard "assisted conversions" definition).
    const assistingSources = new Set(journey.slice(0, -1).map((t) => t.source || "direct"));
    assistingSources.delete(closingSource);
    for (const source of assistingSources) {
      rowFor(source).assistedConversions += 1;
      rowFor(source).assistedRevenue += revenue;
    }
  }

  return Array.from(bySource.values()).sort((a, b) => b.assistedConversions + b.closedConversions - (a.assistedConversions + a.closedConversions));
}
