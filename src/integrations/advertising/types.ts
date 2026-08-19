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
  readonly provider: "GOOGLE" | "META" | "TIKTOK";
  readonly isMock: boolean;
  authenticate(credentials: Record<string, unknown>): Promise<{ ok: boolean }>;
  /** Real check against the provider — must fail honestly if the
   * connection isn't actually usable, never a hardcoded success (same
   * discipline as OAuthConnector/CRMConnector's testConnection). */
  testConnection(): Promise<{ ok: boolean; detail?: string }>;
  listCampaigns(): Promise<NormalizedCampaign[]>;
  getMetrics(campaignExternalId: string, days: number): Promise<NormalizedMetric[]>;
  updateBudget(campaignExternalId: string, newDailyBudget: number): Promise<{ ok: boolean }>;
}
