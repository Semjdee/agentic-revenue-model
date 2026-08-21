/* eslint-disable no-console */
// Scripted end-to-end proof for Influencer Intelligence (docs/
// PHASE_2_TASKS.md Milestone 5's definition of done), modeled directly on
// scripts/demo-journey.ts: create an influencer + tracking link, simulate
// a click + an inbound WhatsApp message carrying the referral token, run
// it through qualification to a WON sale, and print the resulting
// AttributionTouch (confirming source "INFLUENCER" and the correct
// influencer/campaign linkage) — plus the deterministic metrics/score/
// classification and an AI Influencer Analyst recommendation, the same
// way the original script proves the ad-attribution path end to end.
//
// Run `npm run seed` first.
import "dotenv/config";
import { db, schema } from "../src/db/client";
import { eq, desc, and } from "drizzle-orm";
import { generateId } from "../src/lib/ids";
import { startChannelConversation, handleCustomerMessage } from "../src/modules/conversations/engine";
import { createTrackingLink, resolveTrackingLink, buildTrackingLinkUrl, buildWhatsAppDeepLink } from "../src/modules/influencers/tracking-links";
import { extractReferralCode } from "../src/modules/influencers/attribution";
import { computeAttributionForOpportunity } from "../src/modules/attribution/service";
import { computeInfluencerMetrics } from "../src/modules/influencers/metrics";
import { computeCommercialScore, computePublicityScore, classifyCreator } from "../src/modules/influencers/scoring";
import { generateInfluencerRecommendations } from "../src/modules/influencers/analyst";

function log(step: string, detail?: string) {
  console.log(`\n➡️  ${step}${detail ? "\n    " + detail : ""}`);
}

async function main() {
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.name, "Amara")).orderBy(desc(schema.agents.createdAt)).limit(1);
  if (!agent) {
    console.error("No seeded agent found — run `npm run seed` first.");
    process.exit(1);
  }
  const tenantId = agent.tenantId;

  const [whatsappIntegration] = await db
    .select()
    .from(schema.integrations)
    .where(and(eq(schema.integrations.tenantId, tenantId), eq(schema.integrations.provider, "whatsapp")))
    .limit(1);
  const businessWhatsAppNumber = whatsappIntegration?.externalAccountId || "+256700000000";

  log("Business creates an influencer and a tracking link");
  const influencerId = generateId();
  await db.insert(schema.influencers).values({ id: influencerId, tenantId, name: "Demo Creator", handle: "democreator", platform: "INSTAGRAM", category: "Home & lifestyle" });
  const { code } = await createTrackingLink({
    tenantId,
    influencerId,
    campaignName: "Ramadan Solar Push",
    contentLabel: "Reel #1",
    destinationType: "WHATSAPP",
    destinationValue: businessWhatsAppNumber,
  });
  console.log(`    Tracking link: ${buildTrackingLinkUrl(code)}`);
  console.log(`    -> WhatsApp deep link: ${buildWhatsAppDeepLink(businessWhatsAppNumber, code)}`);

  log("Follower clicks the link (logged as a ReferralClick)");
  const link = await resolveTrackingLink(tenantId, code);
  if (!link) throw new Error("Tracking link failed to resolve — aborting.");
  await db.insert(schema.referralClicks).values({ id: generateId(), tenantId, trackingLinkId: link.id, userAgent: "demo-journey-phase2" });

  log("Follower opens WhatsApp with the prefilled referral message and sends it");
  const inboundText = `Ref: ${code}`;
  const detectedCode = extractReferralCode(inboundText);
  if (detectedCode !== code) throw new Error("Referral code detection failed.");
  const resolvedLink = await resolveTrackingLink(tenantId, detectedCode);
  if (!resolvedLink) throw new Error("Referral resolution failed.");

  const started = await startChannelConversation({
    tenantId,
    channel: "WHATSAPP",
    identityType: "WHATSAPP",
    identityValue: "+256700555" + Math.floor(Math.random() * 900 + 100),
    contactName: "Demo Follower",
    content: inboundText,
    referral: { trackingLinkId: resolvedLink.id, influencerId: resolvedLink.influencerId, campaignName: resolvedLink.campaignName, contentLabel: resolvedLink.contentLabel },
  });

  const [conv] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, started.conversationId)).limit(1);
  console.log(`    Conversation created, source=${conv.utmSource} campaign=${conv.utmCampaign} influencerId=${conv.influencerId}`);

  log("Customer says:", "I saw your reel, I want a solar system for my home");
  await handleCustomerMessage({ tenantId, conversationId: started.conversationId, content: "I saw your reel, I want a solar system for my home" });
  log("Customer says:", "My name is Peter Okwir");
  await handleCustomerMessage({ tenantId, conversationId: started.conversationId, content: "My name is Peter Okwir" });
  log("Customer says:", "+256700555123");
  await handleCustomerMessage({ tenantId, conversationId: started.conversationId, content: "+256700555123" });
  log("Customer says:", "It's for my home, a 3 bedroom house");
  await handleCustomerMessage({ tenantId, conversationId: started.conversationId, content: "It's for my home, a 3 bedroom house" });
  log("Customer confirms they want a quotation");
  await handleCustomerMessage({ tenantId, conversationId: started.conversationId, content: "Yes please send me a quotation" });

  const [lead] = await db.select().from(schema.leads).where(eq(schema.leads.conversationId, started.conversationId)).limit(1);
  const [opp] = lead ? await db.select().from(schema.opportunities).where(eq(schema.opportunities.leadId, lead.id)).limit(1) : [null];
  if (!opp) throw new Error("No opportunity created — aborting.");

  log("Sale recorded (opportunity marked WON)");
  const saleId = generateId();
  await db.insert(schema.sales).values({ id: saleId, tenantId, opportunityId: opp.id, contactId: opp.contactId, amount: "12000000", currency: "UGX" });
  await db.update(schema.opportunities).set({ stage: "WON", actualSaleValue: "12000000" }).where(eq(schema.opportunities.id, opp.id));
  await computeAttributionForOpportunity(opp.id, saleId);

  const [lastTouch] = await db
    .select()
    .from(schema.attributionTouches)
    .where(and(eq(schema.attributionTouches.tenantId, tenantId), eq(schema.attributionTouches.opportunityId, opp.id), eq(schema.attributionTouches.touchType, "LAST")))
    .limit(1);

  log("Attribution touch produced by the sale:");
  console.log(`    source=${lastTouch?.source} campaign=${lastTouch?.campaign} influencerId=${lastTouch?.influencerId} trackingLinkId=${lastTouch?.trackingLinkId}`);
  if (lastTouch?.source !== "influencer" || lastTouch?.influencerId !== influencerId) {
    throw new Error(`❌ Attribution did not correctly credit the influencer (got source=${lastTouch?.source}, influencerId=${lastTouch?.influencerId})`);
  }
  console.log("    ✅ Correctly attributed to the influencer, campaign, and tracking link.");

  log("Deterministic metrics + score + classification for this creator:");
  const metrics = await computeInfluencerMetrics(tenantId, influencerId);
  const commercialScore = computeCommercialScore(metrics, [metrics]);
  const publicityScore = computePublicityScore(metrics, [metrics]);
  const classification = classifyCreator(commercialScore, publicityScore, metrics);
  console.log(`    Clicks: ${metrics.clicks}, Conversations: ${metrics.conversationsStarted}, Leads: ${metrics.leads}, Sales: ${metrics.sales}, Revenue: ${metrics.revenue.toLocaleString()}`);
  console.log(`    Commercial score: ${commercialScore}, Publicity score: ${publicityScore}, Classification: ${classification}`);

  log("AI Influencer Analyst generates recommendation(s):");
  const created = await generateInfluencerRecommendations(tenantId);
  const recs = await db.select().from(schema.influencerRecommendations).where(eq(schema.influencerRecommendations.influencerId, influencerId));
  for (const r of recs) console.log(`    [${r.status}] ${r.title} — ${r.recommendation}`);
  if (created.length === 0 && recs.length === 0) throw new Error("❌ No recommendation was generated.");

  console.log("\n✅ Influencer Intelligence demo journey complete — a real WhatsApp referral was tracked from click through to a correctly attributed WON sale, scored, and explained by the AI analyst.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
