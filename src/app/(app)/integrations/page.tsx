"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MessageCircle, Building2, Megaphone, ShoppingBag, Calendar, Webhook } from "lucide-react";

interface IntegrationCard {
  provider: string;
  name: string;
  category: string;
  status: string;
  isMock: boolean;
  id: string | null;
}

const CATEGORY_ICON: Record<string, React.ElementType> = {
  MESSAGING: MessageCircle,
  CRM: Building2,
  ADVERTISING: Megaphone,
  ECOMMERCE: ShoppingBag,
  PRODUCTIVITY: Calendar,
  OTHER: Webhook,
};

const CATEGORY_ORDER = ["MESSAGING", "CRM", "ADVERTISING", "ECOMMERCE", "PRODUCTIVITY", "OTHER"];

export default function IntegrationsPage() {
  const [cards, setCards] = useState<IntegrationCard[]>([]);

  async function load() {
    setCards(await api.get<IntegrationCard[]>("/api/internal/integrations"));
  }
  useEffect(() => {
    load();
  }, []);

  // Providers with a real staged connector (state validation, webhook
  // registration + a real connection test gating CONNECTED — see
  // src/integrations/oauth/connect-flow.ts for WhatsApp/Instagram and
  // src/app/api/internal/integrations/crm/[provider]/** for CRM) route
  // through that flow instead of the generic one-click mock-connect
  // below. Every other provider on this page (Advertising/Ecommerce/
  // Productivity) is outside the current onboarding priority's P0/P1
  // scope (docs/ONBOARDING_SPEC.md section 37) and keeps the original
  // simple mock — real per-provider connectors get added here as each
  // one is built, not all at once.
  const OAUTH_PROVIDERS = new Set(["whatsapp", "instagram"]);
  const CRM_PROVIDERS = new Set(["hubspot", "kommo", "salesforce", "zoho", "odoo", "custom_crm"]);

  async function toggle(card: IntegrationCard) {
    if (card.status === "CONNECTED") {
      await api.post(`/api/internal/integrations/${card.provider}/disconnect`);
      load();
      return;
    }
    if (OAUTH_PROVIDERS.has(card.provider)) {
      const { authorizationUrl } = await api.post<{ authorizationUrl: string }>(`/api/internal/integrations/${card.provider}/connect`, { returnTo: "/integrations" });
      window.location.href = authorizationUrl;
      return;
    }
    if (CRM_PROVIDERS.has(card.provider)) {
      const { authorizationUrl } = await api.post<{ authorizationUrl: string }>(`/api/internal/integrations/crm/${card.provider}/connect`, { returnTo: "/integrations" });
      window.location.href = authorizationUrl;
      return;
    }
    await api.post(`/api/internal/integrations/${card.provider}/connect`, { category: card.category });
    load();
  }

  return (
    <div className="pb-12">
      <PageHeader
        title="Integrations"
        description="No live third-party credentials in this environment — connecting uses a clearly labelled demo/mock connector so the full workflow is testable."
      />
      <div className="px-5 md:px-8 space-y-6">
        {CATEGORY_ORDER.map((cat) => {
          const items = cards.filter((c) => c.category === cat);
          if (!items.length) return null;
          const Icon = CATEGORY_ICON[cat];
          return (
            <div key={cat}>
              <p className="text-[12px] font-semibold text-ink-muted uppercase tracking-wide mb-2">{cat}</p>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {items.map((c) => (
                  <div key={c.provider} className="card p-4">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-black/[0.04] dark:bg-white/10 flex items-center justify-center">
                        <Icon size={15} className="text-ink-secondary" />
                      </div>
                      <p className="text-[13px] font-medium text-ink-primary">{c.name}</p>
                    </div>
                    <div className="flex items-center justify-between mt-3">
                      <Badge tone={c.status === "CONNECTED" ? "good" : "neutral"}>{c.status === "CONNECTED" ? `Connected${c.isMock ? " (mock)" : ""}` : "Not connected"}</Badge>
                      <Button size="sm" variant={c.status === "CONNECTED" ? "secondary" : "primary"} onClick={() => toggle(c)}>
                        {c.status === "CONNECTED" ? "Disconnect" : "Connect"}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
