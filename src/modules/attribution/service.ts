import { db, schema } from "@/db/client";
import { generateId } from "@/lib/ids";
import { eq } from "drizzle-orm";

// ============================================================================
// Attribution Engine (spec section 12).
//
// Captures first-touch and last-touch attribution. Per-conversation UTM /
// click-ID capture already happens on the `conversations` table (mirroring
// what the widget sends — spec section 1). This service promotes that data
// into durable `attribution_touches` rows tied to the Lead/Opportunity/Sale
// once those entities exist, and records a `traffic_sessions` row per widget
// session so the model is ready for true multi-touch attribution later
// (currently we compute FIRST from the earliest conversation for a contact
// and LAST from the most recent one — additional models, e.g. linear or
// time-decay, can be added without a schema change).
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

function conversationToTouch(conv: typeof schema.conversations.$inferSelect, touchType: "FIRST" | "LAST") {
  return {
    id: generateId(),
    tenantId: conv.tenantId,
    sessionId: conv.sessionId,
    contactId: conv.contactId,
    source: conv.utmSource ?? (conv.gclid ? "google" : conv.fbclid ? "meta" : "direct"),
    medium: conv.utmMedium ?? "organic",
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
  }
}
