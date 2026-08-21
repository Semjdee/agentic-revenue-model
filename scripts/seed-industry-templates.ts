/* eslint-disable no-console */
// Seeds the initial 3 industry templates (Solar, Real Estate, Travel —
// Industry Team Subscription Architecture doc's own worked examples) into
// industry_templates. Idempotent: skips a key that already exists, so
// this is safe to re-run. More industries are additive rows, not code —
// use the Platform Admin "Industry Templates" page or
// POST /api/platform/industry-templates to add them.
// Run with: npm run seed-industry-templates
import "dotenv/config";
import { db, schema } from "../src/db/client";
import { eq } from "drizzle-orm";
import { generateId } from "../src/lib/ids";

const TEMPLATES = [
  {
    key: "SOLAR",
    label: "Solar & Renewable Energy",
    description: "Residential/commercial solar installers and equipment resellers.",
    tone: "consultative, technical but approachable",
    qualificationQuestions: [
      "What's your average monthly electricity bill or usage?",
      "Is this for a residential or commercial property?",
      "Do you own the property, and is the roof/site suitable for panels (age, shading, orientation)?",
      "Are you looking to go fully off-grid, or add solar backup alongside the grid?",
      "What's your target timeline for installation?",
    ],
    salesRules: [
      "Never promise an exact system size or price without a site assessment — give a realistic range instead.",
      "Always mention available financing or pay-as-you-go options if the customer asks about upfront cost.",
      "Warranty terms vary by equipment brand — never state a warranty length without checking the product catalogue.",
    ],
    restrictedTopics: [
      "Never guarantee a specific payback period or savings percentage — actual savings depend on usage, tariffs, and site conditions.",
    ],
    escalationConditions: [
      "Customer requests a formal site assessment or quote.",
      "Customer asks about financing eligibility or credit terms.",
      "Customer reports an existing system fault or safety concern.",
    ],
    knowledgeBaseSuggestions: [
      "Solar panel & inverter product catalogue with wattage and pricing",
      "Financing / pay-as-you-go plan terms",
      "Installation process and typical timeline",
      "Warranty and maintenance policy",
      "Site assessment checklist (roof type, shading, orientation)",
    ],
    productCategorySuggestions: ["Solar panels", "Inverters", "Batteries", "Installation & mounting", "Maintenance plans"],
  },
  {
    key: "REAL_ESTATE",
    label: "Real Estate",
    description: "Property sales, rentals, and agency listings.",
    tone: "professional, warm, trustworthy",
    qualificationQuestions: [
      "Are you looking to buy, rent, or sell?",
      "What's your target location or neighborhood?",
      "What's your budget range?",
      "How many bedrooms/bathrooms and what property type are you looking for?",
      "What's your ideal move-in or closing timeline?",
    ],
    salesRules: [
      "Never confirm a property is still available without checking current listing status.",
      "Never state a final price as negotiable or fixed without checking with the listing agent.",
      "Always offer to schedule a viewing when the customer shows genuine interest in a specific listing.",
    ],
    restrictedTopics: [
      "Never give legal or tax advice about property transactions — offer to connect them with a qualified professional instead.",
    ],
    escalationConditions: [
      "Customer wants to schedule a property viewing.",
      "Customer is ready to make an offer.",
      "Customer asks about mortgage, financing, or legal process details.",
    ],
    knowledgeBaseSuggestions: [
      "Current property listings with price, size, and location",
      "Viewing scheduling process and availability",
      "Financing/mortgage partner information",
      "Neighborhood and amenity guides",
    ],
    productCategorySuggestions: ["Residential sale", "Residential rental", "Commercial property", "Land"],
  },
  {
    key: "TRAVEL",
    label: "Travel & Tourism",
    description: "Tour operators, travel agencies, and booking services.",
    tone: "friendly, enthusiastic, helpful",
    qualificationQuestions: [
      "Where would you like to travel, and when?",
      "How many travelers, and any specific needs (kids, accessibility)?",
      "What's your budget per person or for the whole trip?",
      "Are you looking for a package (flights + hotel + activities) or specific components?",
      "Do you have a return date in mind, or is this open-ended?",
    ],
    salesRules: [
      "Never confirm flight/hotel availability or exact pricing without checking current inventory — quote a starting-from range instead.",
      "Always mention visa, vaccination, or entry requirements when relevant to the destination if known.",
      "Never promise refundability or cancellation terms without checking the specific package's policy.",
    ],
    restrictedTopics: ["Never guarantee weather, safety conditions, or that no travel advisories are in effect — direct to official sources."],
    escalationConditions: [
      "Customer is ready to book.",
      "Customer asks about a refund, cancellation, or complaint on an existing booking.",
      "Customer needs a custom multi-destination itinerary.",
    ],
    knowledgeBaseSuggestions: [
      "Current package prices and itineraries by destination",
      "Visa and entry requirement notes by destination",
      "Cancellation and refund policy",
      "Payment plan / deposit options",
    ],
    productCategorySuggestions: ["Package tours", "Flights", "Accommodation", "Local activities & excursions"],
  },
];

async function main() {
  console.log("Seeding industry templates…");
  for (const t of TEMPLATES) {
    const [existing] = await db.select().from(schema.industryTemplates).where(eq(schema.industryTemplates.key, t.key)).limit(1);
    if (existing) {
      console.log(`  ${t.key} already exists — skipping.`);
      continue;
    }
    await db.insert(schema.industryTemplates).values({ id: generateId(), ...t, isActive: true });
    console.log(`  Created ${t.key} (${t.label}).`);
  }
  console.log("Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
