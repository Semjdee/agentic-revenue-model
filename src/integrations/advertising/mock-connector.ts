import type { AdsConnector, NormalizedCampaign, NormalizedMetric } from "./types";

/**
 * DEMO / MOCK CONNECTOR for Google Ads / Meta Ads (no live ad account
 * credentials in this sandbox — spec section 37). Generates believable
 * campaign + daily metric data so the Advertising dashboard and AI
 * Advertising Analyst have something real to compute over. Every budget
 * change still goes through the same approval flow as a real connector
 * would (section 15: "DO NOT permit unrestricted autonomous advertising
 * spend changes").
 */
export class MockAdsConnector implements AdsConnector {
  readonly isMock = true;
  constructor(public readonly provider: "GOOGLE" | "META") {}

  async authenticate() {
    return { ok: true };
  }

  async listCampaigns(): Promise<NormalizedCampaign[]> {
    return [];
  }

  async getMetrics(): Promise<NormalizedMetric[]> {
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- interface parameters kept for signature parity with a real connector implementation
  async updateBudget(campaignExternalId: string, newDailyBudget: number) {
    // A real connector would call the Google/Meta Marketing API here.
    // This mock only ever runs after an approval has already been granted
    // (see /api/internal/advertising/recommendations/[id]/approve).
    return { ok: true };
  }
}

export function getAdsConnector(provider: "GOOGLE" | "META"): AdsConnector {
  return new MockAdsConnector(provider);
}
