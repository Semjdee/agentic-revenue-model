/* eslint-disable no-console */
// Seeds a believable demo company — RayGrid Solar Energy (spec section 30).
// Run with: npm run seed
import "dotenv/config";
import { db, schema } from "../src/db/client";
import { generateId, generatePublicAgentId } from "../src/lib/ids";
import { hashPassword } from "../src/lib/auth";
import { indexDocument } from "../src/modules/knowledge/service";

async function main() {
  console.log("Seeding RayGrid Solar Energy demo tenant…");

  const tenantId = generateId();
  await db.insert(schema.tenants).values({ id: tenantId, name: "RayGrid Solar Energy", slug: "raygrid-solar-" + tenantId.slice(0, 6) });

  const workspaceId = generateId();
  await db.insert(schema.workspaces).values({ id: workspaceId, tenantId, name: "Default Workspace" });

  const ownerId = generateId();
  await db.insert(schema.users).values({
    id: ownerId,
    tenantId,
    workspaceId,
    email: "owner@raygrid.demo",
    passwordHash: await hashPassword("password123"),
    name: "Grace Namono",
    role: "OWNER",
  });
  const salesUserId = generateId();
  await db.insert(schema.users).values({
    id: salesUserId,
    tenantId,
    workspaceId,
    email: "sales@raygrid.demo",
    passwordHash: await hashPassword("password123"),
    name: "David Okello",
    role: "SALES",
  });

  // ---- Products -----------------------------------------------------
  const productDefs = [
    { name: "3kW Home Solar System", category: "Residential Solar", price: "9500000", description: "Ideal for a 2-3 bedroom home. Covers lighting, fridge, TV, and phone charging.", features: ["3kW inverter", "2x 200Ah batteries", "6 solar panels"], sellingPoints: ["10-year panel warranty", "Free installation within Kampala"] },
    { name: "5kW Hybrid Solar System", category: "Residential Solar", price: "18000000", description: "Ideal for a 4+ bedroom home. Runs most appliances including AC units.", features: ["5kW hybrid inverter", "4x 200Ah batteries", "10 solar panels", "Grid + battery + solar hybrid switching"], sellingPoints: ["10-year panel warranty", "24-month battery warranty", "Free installation within Kampala"] },
    { name: "10kW Commercial Solar System", category: "Commercial Solar", price: "42000000", description: "For small businesses, shops, and offices.", features: ["10kW inverter", "8x 200Ah batteries", "20 solar panels"], sellingPoints: ["10-year panel warranty", "Dedicated account manager"] },
    { name: "Solar Water Pump", category: "Water Solutions", price: "4200000", description: "Off-grid water pumping for boreholes and irrigation.", features: ["1HP solar pump", "2 solar panels"], sellingPoints: ["No fuel costs", "5-year warranty"] },
    { name: "Solar Water Heater", category: "Water Solutions", price: "3100000", description: "200L solar water heating system.", features: ["200L tank", "Evacuated tube collectors"], sellingPoints: ["5-year warranty"] },
  ];
  const productIds: Record<string, string> = {};
  for (const p of productDefs) {
    const id = generateId();
    productIds[p.name] = id;
    await db.insert(schema.products).values({ id, tenantId, currency: "UGX", availability: "IN_STOCK", ...p });
  }

  // ---- Knowledge Base -------------------------------------------------
  const collectionDefs = ["Products", "Pricing", "Warranty", "Delivery", "Company", "FAQs", "Sales Policies"];
  const collectionIds: Record<string, string> = {};
  for (const name of collectionDefs) {
    const id = generateId();
    collectionIds[name] = id;
    await db.insert(schema.knowledgeCollections).values({ id, tenantId, name });
  }
  await indexDocument({
    tenantId,
    collectionId: collectionIds["Warranty"],
    title: "Panel & battery warranty",
    content: "All RayGrid solar panels carry a 10-year manufacturer warranty. Batteries carry a 24-month warranty. Inverters carry a 5-year warranty. Warranty covers manufacturing defects, not physical damage.",
    sourceType: "MANUAL",
  });
  await indexDocument({
    tenantId,
    collectionId: collectionIds["Delivery"],
    title: "Delivery & installation timelines",
    content: "Standard delivery and installation takes 5-7 working days within Kampala after deposit payment, and 10-14 working days upcountry. Installation is included free of charge within Kampala.",
    sourceType: "MANUAL",
  });
  await indexDocument({
    tenantId,
    collectionId: collectionIds["Sales Policies"],
    title: "Payment options",
    content: "We accept full upfront payment, or a 50% deposit with the balance on completion of installation. We also partner with local SACCOs for 3, 6, and 12-month financing plans on approval.",
    sourceType: "FAQ",
  });
  await indexDocument({
    tenantId,
    collectionId: collectionIds["Company"],
    title: "About RayGrid Solar Energy",
    content: "RayGrid Solar Energy has installed over 1,200 solar systems across Uganda since 2018. We are a certified UNBS solar installer with offices in Kampala, Mbarara, and Gulu.",
    sourceType: "MANUAL",
  });

  // ---- AI Agent ---------------------------------------------------------
  const agentId = generateId();
  const publicAgentId = generatePublicAgentId();
  await db.insert(schema.agents).values({
    id: agentId,
    tenantId,
    publicAgentId,
    name: "Amara",
    avatarUrl: null,
    role: "Sales Assistant",
    company: "RayGrid Solar Energy",
    instructions: "Help customers find the right solar system for their home or business. Always ask qualifying questions before recommending a product. Be warm, concise, and never pushy.",
    tone: "friendly, professional, concise",
    greeting: "Hi! I'm Amara from RayGrid Solar Energy ☀️ What are you looking for today?",
    qualificationQuestions: [
      "What are you looking for today?",
      "Could I get your name?",
      "What's the best phone number or email to reach you on?",
      "And where are you located, or is this for your home or business?",
    ],
    restrictedTopics: ["medical advice", "unrelated legal advice"],
    escalationConditions: ["customer explicitly asks for a human", "customer requests a discount", "question can't be answered from the knowledge base"],
    salesRules: ["never discount without approval", "always confirm requirements before recommending a system size"],
    widgetColor: "#eb6834",
    launcherPosition: "bottom-right",
    status: "ACTIVE",
  });

  // ---- Advertising: Google + Meta campaigns with 30 days of metrics -----
  const googleAccountId = generateId();
  await db.insert(schema.adAccounts).values({ id: googleAccountId, tenantId, provider: "GOOGLE", externalAccountId: "goog_demo_001", name: "RayGrid Google Ads", isMock: true });
  const metaAccountId = generateId();
  await db.insert(schema.adAccounts).values({ id: metaAccountId, tenantId, provider: "META", externalAccountId: "meta_demo_001", name: "RayGrid Meta Ads", isMock: true });

  const googleCampaignId = generateId();
  await db.insert(schema.campaigns).values({ id: googleCampaignId, tenantId, adAccountId: googleAccountId, externalId: "camp_goog_1", name: "Residential Solar Search", objective: "LEADS", dailyBudget: "150000", currency: "UGX" });

  // Name matches the utm_campaign value the widget/demo journey sends, so
  // attribution touches (which store campaign as a name string) join back
  // to this campaign row for the AI Advertising Analyst.
  const metaCampaignId = generateId();
  await db.insert(schema.campaigns).values({ id: metaCampaignId, tenantId, adAccountId: metaAccountId, externalId: "camp_meta_1", name: "Residential Solar Campaign", objective: "LEADS", dailyBudget: "100000", currency: "UGX" });

  const metaAdSetId = generateId();
  await db.insert(schema.adSets).values({ id: metaAdSetId, tenantId, campaignId: metaCampaignId, externalId: "adset_meta_1", name: "Residential Solar — Kampala 25-55" });
  await db.insert(schema.ads).values({ id: generateId(), tenantId, adSetId: metaAdSetId, externalId: "ad_meta_1", name: "Residential Solar Video Ad", creative: { format: "video" } });

  const underperformingCampaignId = generateId();
  await db.insert(schema.campaigns).values({ id: underperformingCampaignId, tenantId, adAccountId: googleAccountId, externalId: "camp_goog_2", name: "Commercial Solar Display", objective: "AWARENESS", dailyBudget: "80000", currency: "UGX" });

  const today = new Date();
  for (let i = 0; i < 21; i++) {
    const date = new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10);
    // High-performing campaign (drives most seeded conversations/sales below)
    await db.insert(schema.adMetricSnapshots).values({
      id: generateId(), tenantId, campaignId: metaCampaignId, date,
      spend: "90000", impressions: 9000, clicks: 210, conversations: 3, leads: 2, qualifiedLeads: 2, sales: i < 10 ? 1 : 0, revenue: i < 10 ? "18000000" : "0",
    });
    // Underperforming campaign
    await db.insert(schema.adMetricSnapshots).values({
      id: generateId(), tenantId, campaignId: underperformingCampaignId, date,
      spend: "80000", impressions: 15000, clicks: 90, conversations: 1, leads: 1, qualifiedLeads: 0, sales: 0, revenue: "0",
    });
    // Google search campaign — moderate performance, low qualification rate to trigger "Review Targeting"
    await db.insert(schema.adMetricSnapshots).values({
      id: generateId(), tenantId, campaignId: googleCampaignId, date,
      spend: "60000", impressions: 4000, clicks: 150, conversations: 4, leads: 3, qualifiedLeads: 0, sales: 0, revenue: "0",
    });
  }

  // ---- A few extra demo contacts/conversations for Contacts/Inbox richness ----
  const extraChannels: { channel: "WHATSAPP" | "INSTAGRAM" | "WEBSITE"; name: string }[] = [
    { channel: "WHATSAPP", name: "Peter Ssebunya" },
    { channel: "INSTAGRAM", name: "Grace Atim" },
    { channel: "WEBSITE", name: "Michael Byaruhanga" },
  ];
  for (const c of extraChannels) {
    const contactId = generateId();
    await db.insert(schema.contacts).values({ id: contactId, tenantId, name: c.name, phone: "+2567" + Math.floor(10000000 + Math.random() * 89999999) });
    const conversationId = generateId();
    await db.insert(schema.conversations).values({
      id: conversationId, tenantId, contactId, agentId, channel: c.channel, status: "OPEN", aiActive: true,
      utmSource: c.channel === "WEBSITE" ? "google" : c.channel.toLowerCase(), utmCampaign: c.channel === "WEBSITE" ? "Residential Solar Search" : undefined,
    });
    await db.insert(schema.messages).values({ id: generateId(), tenantId, conversationId, sender: "AI", content: "Hi! I'm Amara from RayGrid Solar Energy ☀️ What are you looking for today?" });
    await db.insert(schema.messages).values({ id: generateId(), tenantId, conversationId, sender: "CUSTOMER", content: "Hi, do you sell solar water heaters? Also is there a warranty?" });
    const leadId = generateId();
    await db.insert(schema.leads).values({ id: leadId, tenantId, contactId, conversationId, stage: "CONTACTED", score: 20, source: c.channel.toLowerCase() });
  }

  // ---- A lost opportunity for Conversation Intelligence richness ----
  const lostContactId = generateId();
  await db.insert(schema.contacts).values({ id: lostContactId, tenantId, name: "Esther Namutebi", phone: "+256700111222" });
  const lostLeadId = generateId();
  await db.insert(schema.leads).values({ id: lostLeadId, tenantId, contactId: lostContactId, stage: "LOST", score: 40, source: "meta" });
  const lostOppId = generateId();
  await db.insert(schema.opportunities).values({ id: lostOppId, tenantId, leadId: lostLeadId, contactId: lostContactId, estimatedValue: "18000000", stage: "LOST", lostReason: "Price" });

  console.log("\n✅ Seed complete.\n");
  console.log("Login:      owner@raygrid.demo / password123");
  console.log("Sales user: sales@raygrid.demo / password123");
  console.log("Agent public ID:", publicAgentId);
  console.log("Demo widget page: /demo?agent=" + publicAgentId);
  console.log("\nRun `npm run demo-journey` next to simulate the full ad -> sale -> attribution loop.\n");

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
