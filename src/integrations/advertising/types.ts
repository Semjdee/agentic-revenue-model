// Dedicated ad-platform adapters (spec section 13: GoogleAdsConnector,
// MetaAdsConnector). UI components never talk to Google/Meta objects
// directly — everything is normalized to our internal AdAccount / Campaign
// / AdSet / Ad / AdMetricSnapshot shape by this layer first.
export interface NormalizedCampaign {
  externalId: string;
  name: string;
  status: string;
  objective?: string;
  dailyBudget?: number;
  currency: string;
}
export interface NormalizedMetric {
  campaignExternalId: string;
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
}

export interface AdsConnector {
  readonly provider: "GOOGLE" | "META";
  readonly isMock: boolean;
  authenticate(credentials: Record<string, unknown>): Promise<{ ok: boolean }>;
  listCampaigns(): Promise<NormalizedCampaign[]>;
  getMetrics(campaignExternalId: string, days: number): Promise<NormalizedMetric[]>;
  updateBudget(campaignExternalId: string, newDailyBudget: number): Promise<{ ok: boolean }>;
}
