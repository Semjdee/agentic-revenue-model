import type { AdsConnector, NormalizedCampaign, NormalizedMetric } from "./types";

/**
 * DEMO / MOCK CONNECTOR for Google Ads / Meta Ads / TikTok Ads (no live ad
 * account credentials in this sandbox — spec section 37). Generates
 * believable campaign + daily metric data — deterministically, seeded from
 * the campaign id + date, so repeated syncs don't reshuffle history — so
 * the Advertising dashboard and AI Advertising Analyst have something real
 * to compute over. Every budget change still goes through the same
 * approval flow as a real connector would (section 15: "DO NOT permit
 * unrestricted autonomous advertising spend changes").
 *
 * `platformLabel` distinguishes Instagram-placement vs Facebook-placement
 * campaigns under the same Meta provider (self-onboarding treats them as
 * two independent connections — see
 * src/app/api/internal/integrations/ads/[provider]/connect — even though
 * a real Meta Business account can serve both from one OAuth grant; this
 * mirrors how a tenant can have separate Instagram-only and Facebook-only
 * ad accounts in practice).
 */
const CAMPAIGN_TEMPLATES: Record<string, { name: string; objective: string }[]> = {
  GOOGLE: [
    { name: "Search — Solar Installation Uganda", objective: "LEAD_GENERATION" },
    { name: "Performance Max — Residential Solar", objective: "SALES" },
  ],
  "META:instagram": [
    { name: "Instagram Reels — Residential Solar", objective: "AWARENESS" },
    { name: "Instagram Story Ads — Free Quote", objective: "LEAD_GENERATION" },
  ],
  "META:facebook": [
    { name: "Facebook Feed — Residential Solar Campaign", objective: "SALES" },
    { name: "Facebook Lead Ads — Solar Savings Calculator", objective: "LEAD_GENERATION" },
  ],
  TIKTOK: [
    { name: "Spark Ads — Solar Savings Challenge", objective: "AWARENESS" },
    { name: "In-Feed Ads — Affordable Solar Financing", objective: "LEAD_GENERATION" },
  ],
};

/** Tiny deterministic PRNG (mulberry32) seeded from a string — same input
 * always produces the same sequence, so a re-sync doesn't reshuffle
 * history that's already been shown to (and possibly acted on by) the
 * tenant. Not cryptographic; only used for believable demo numbers. */
function seededRandom(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

export class MockAdsConnector implements AdsConnector {
  readonly isMock = true;
  constructor(public readonly provider: "GOOGLE" | "META" | "TIKTOK", private readonly platformLabel?: "instagram" | "facebook") {}

  async authenticate() {
    return { ok: true };
  }

  async testConnection(): Promise<{ ok: boolean; detail?: string }> {
    // Real connector: a lightweight read-only call (e.g. list accessible
    // ad accounts). Mocked as "we successfully authenticated" since this
    // class has no real failure mode to distinguish — genuinely fails
    // only if authenticate() itself was never called first, which the
    // callback route always does before this.
    return { ok: true };
  }

  private templateKey(): string {
    if (this.provider === "META" && this.platformLabel) return `META:${this.platformLabel}`;
    return this.provider;
  }

  async listCampaigns(): Promise<NormalizedCampaign[]> {
    const templates = CAMPAIGN_TEMPLATES[this.templateKey()] ?? CAMPAIGN_TEMPLATES.GOOGLE;
    return templates.map((t, i) => ({
      externalId: `${this.provider.toLowerCase()}_${this.platformLabel ?? "campaign"}_${i}_${Buffer.from(t.name).toString("hex").slice(0, 8)}`,
      name: t.name,
      status: "ACTIVE",
      objective: t.objective,
      dailyBudget: 40000 + Math.floor(seededRandom(t.name)() * 40000),
      currency: "UGX",
    }));
  }

  async getMetrics(campaignExternalId: string, days: number): Promise<NormalizedMetric[]> {
    const metrics: NormalizedMetric[] = [];
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().slice(0, 10);
      const rand = seededRandom(`${campaignExternalId}:${dateStr}`);
      const spend = Math.round(30000 + rand() * 60000);
      const impressions = Math.round(1500 + rand() * 4000);
      const clicks = Math.round(impressions * (0.015 + rand() * 0.035));
      metrics.push({ campaignExternalId, date: dateStr, spend, impressions, clicks });
    }
    return metrics;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- interface parameters kept for signature parity with a real connector implementation
  async updateBudget(campaignExternalId: string, newDailyBudget: number) {
    // A real connector would call the Google/Meta/TikTok Marketing API
    // here. This mock only ever runs after an approval has already been
    // granted (see /api/internal/advertising/recommendations/[id]/approve).
    return { ok: true };
  }
}

export function getAdsConnector(provider: "GOOGLE" | "META" | "TIKTOK", platformLabel?: "instagram" | "facebook"): AdsConnector {
  return new MockAdsConnector(provider, platformLabel);
}
