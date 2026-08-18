import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api";

const CATALOG: { provider: string; category: string; name: string }[] = [
  { provider: "whatsapp", category: "MESSAGING", name: "WhatsApp" },
  { provider: "instagram", category: "MESSAGING", name: "Instagram" },
  { provider: "messenger", category: "MESSAGING", name: "Facebook Messenger" },
  { provider: "hubspot", category: "CRM", name: "HubSpot" },
  { provider: "kommo", category: "CRM", name: "Kommo" },
  { provider: "salesforce", category: "CRM", name: "Salesforce" },
  { provider: "zoho", category: "CRM", name: "Zoho" },
  { provider: "odoo", category: "CRM", name: "Odoo" },
  { provider: "custom_crm", category: "CRM", name: "Custom API" },
  { provider: "google_ads", category: "ADVERTISING", name: "Google Ads" },
  { provider: "meta_ads", category: "ADVERTISING", name: "Meta Ads" },
  { provider: "shopify", category: "ECOMMERCE", name: "Shopify" },
  { provider: "woocommerce", category: "ECOMMERCE", name: "WooCommerce" },
  { provider: "custom_store", category: "ECOMMERCE", name: "Custom Store" },
  { provider: "google_calendar", category: "PRODUCTIVITY", name: "Google Calendar" },
  { provider: "gmail", category: "PRODUCTIVITY", name: "Gmail" },
  { provider: "slack", category: "PRODUCTIVITY", name: "Slack" },
];

export async function GET() {
  const session = await getSession();
  if (!session) return jsonError("Not authenticated", 401);
  const rows = await db.select().from(schema.integrations).where(eq(schema.integrations.tenantId, session.tenantId));
  const byProvider = new Map(rows.map((r) => [r.provider, r]));

  const cards = CATALOG.map((c) => {
    const existing = byProvider.get(c.provider);
    return {
      provider: c.provider,
      name: c.name,
      category: c.category,
      status: existing?.status ?? "NOT_CONNECTED",
      isMock: existing?.isMock ?? true,
      lastSyncAt: existing?.lastSyncAt ?? null,
      id: existing?.id ?? null,
    };
  });

  return jsonOk(cards);
}
