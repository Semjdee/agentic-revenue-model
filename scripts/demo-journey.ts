/* eslint-disable no-console */
// Runs the exact end-to-end scenario from spec section 31 against the real
// database and application logic (no HTTP server required — it calls the
// same functions the API routes call). Run `npm run seed` first.
//
//   Facebook ad click -> widget conversation -> AI qualification ->
//   product recommendation -> lead -> CRM opportunity -> follow-up
//   scheduled -> opportunity WON -> sale recorded -> attribution engine ->
//   AI Advertising Analyst recommendation -> human approval
import "dotenv/config";
import { db, schema } from "../src/db/client";
import { eq, desc } from "drizzle-orm";
import { generateId } from "../src/lib/ids";
import { startConversation, handleCustomerMessage } from "../src/modules/conversations/engine";
import { computeAttributionForOpportunity } from "../src/modules/attribution/service";
import { generateAdvertisingRecommendations, computeCampaignPerformance } from "../src/modules/advertising/analyst";
import { logAudit } from "../src/lib/audit";

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

  log("Customer clicks Facebook 'Residential Solar' advertisement, lands on RayGrid's website");
  const started = await startConversation({
    publicAgentId: agent.publicAgentId,
    sessionId: "demo_journey_" + Date.now(),
    channel: "WEBSITE",
    landingPage: "https://raygrid.demo/solar",
    referringUrl: "https://facebook.com/",
    currentPage: "https://raygrid.demo/solar",
    utmSource: "meta",
    utmMedium: "paid_social",
    utmCampaign: "Residential Solar Campaign",
    utmContent: "Residential Solar Video Ad",
    fbclid: "fb.demo." + Date.now(),
    consentAcknowledged: true,
  });
  const conversationId = started.conversationId;
  console.log("    Conversation created:", conversationId);
  console.log("    Greeting:", started.messages[started.messages.length - 1]?.content);

  const turns = [
    "Hi, I'm interested in installing solar for my home",
    "My name is John Mukasa",
    "+256700123456",
    "It's for my home — a 4 bedroom house in Kampala",
  ];

  for (const message of turns) {
    log("Customer says:", message);
    const reply = await handleCustomerMessage({ tenantId, conversationId, content: message });
    console.log("    AI qualification question / reply:", reply.message);
  }

  log("Customer confirms they want a quotation");
  const quoteReply = await handleCustomerMessage({ tenantId, conversationId, content: "Yes please, send me a quotation" });
  console.log("    AI:", quoteReply.message);

  const [lead] = await db.select().from(schema.leads).where(eq(schema.leads.conversationId, conversationId)).limit(1);
  const [opportunity] = lead ? await db.select().from(schema.opportunities).where(eq(schema.opportunities.leadId, lead.id)).limit(1) : [null];

  if (!opportunity) {
    console.error("Expected an opportunity to have been created by the AI tool-call flow — aborting.");
    process.exit(1);
  }

  log("Lead qualified -> appears in internal CRM", `Lead stage: ${lead!.stage}, Opportunity stage: ${opportunity.stage}, Follow-up scheduled: ${opportunity.nextFollowUpAt}`);

  log("Salesperson takes over conversation");
  await db.update(schema.conversations).set({ aiActive: false }).where(eq(schema.conversations.id, conversationId));

  log("Opportunity marked WON, sale recorded");
  const saleId = generateId();
  const amount = "18000000";
  await db.insert(schema.sales).values({ id: saleId, tenantId, opportunityId: opportunity.id, contactId: opportunity.contactId, amount, currency: "UGX", products: opportunity.products ?? [] });
  await db.update(schema.opportunities).set({ stage: "WON", actualSaleValue: amount }).where(eq(schema.opportunities.id, opportunity.id));
  await db.update(schema.leads).set({ stage: "WON" }).where(eq(schema.leads.id, lead!.id));
  await logAudit({ tenantId, action: "sale.created", entity: "sale", entityId: saleId, after: { amount }, source: "SYSTEM" });
  console.log(`    Sale recorded: UGX ${Number(amount).toLocaleString()}`);

  await computeAttributionForOpportunity(opportunity.id, saleId);
  const touches = await db.select().from(schema.attributionTouches).where(eq(schema.attributionTouches.saleId, saleId));
  log("Attribution engine assigns sale to:");
  for (const t of touches) {
    console.log(`    [${t.touchType}] source=${t.source} campaign=${t.campaign} ad=${t.adName ?? "n/a"}`);
  }

  log("Dashboard would now show updated Revenue / Sales / ROAS / Campaign attribution");
  const perf = await computeCampaignPerformance(tenantId, 30);
  for (const p of perf) {
    console.log(`    ${p.campaignName}: spend=${p.spend} revenue=${p.revenue} sales=${p.sales} roas=${p.roas.toFixed(1)}x`);
  }

  log("AI Advertising Analyst generates recommendation(s)");
  const createdIds = await generateAdvertisingRecommendations(tenantId);
  const recs = createdIds.length ? await db.select().from(schema.advertisingRecommendations).where(eq(schema.advertisingRecommendations.tenantId, tenantId)) : [];
  for (const r of recs.filter((r) => createdIds.includes(r.id))) {
    console.log(`    [${r.status}] ${r.title} — ${r.recommendation}`);
  }

  const increaseBudgetRec = recs.find((r) => createdIds.includes(r.id) && r.title === "Increase Budget");
  if (increaseBudgetRec) {
    log("Human approves the budget-increase recommendation (spec: user MUST approve budget-impacting actions)");
    await db.update(schema.advertisingRecommendations).set({ status: "IMPLEMENTED", decidedAt: new Date() }).where(eq(schema.advertisingRecommendations.id, increaseBudgetRec.id));
    await logAudit({ tenantId, action: "advertising.recommendation_decided", entity: "advertising_recommendation", entityId: increaseBudgetRec.id, after: { decision: "APPROVED" }, source: "SYSTEM" });
    console.log("    Approved and marked IMPLEMENTED — logged to Audit Log.");
  } else {
    console.log("    (No 'Increase Budget' recommendation triggered this run — thresholds not met with current seed data.)");
  }

  console.log("\n✅ Demo journey complete. Open the back-office Inbox to see this conversation, or /dashboard for updated KPIs.\n");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
