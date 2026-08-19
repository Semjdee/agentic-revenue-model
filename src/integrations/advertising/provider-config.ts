// One source of truth for every self-onboardable advertising analytics
// provider — the connect/callback routes, the consent page, and the
// Integrations card catalog all read from this instead of each keeping
// their own copy of the provider list.
export const ADS_PROVIDERS: Record<
  string,
  { label: string; color: string; letter: string; connectorProvider: "GOOGLE" | "META" | "TIKTOK"; platformLabel?: "instagram" | "facebook" }
> = {
  instagram_ads: { label: "Instagram Ads", color: "#E1306C", letter: "I", connectorProvider: "META", platformLabel: "instagram" },
  facebook_ads: { label: "Facebook Ads", color: "#1877F2", letter: "F", connectorProvider: "META", platformLabel: "facebook" },
  google_ads: { label: "Google Ads", color: "#4285F4", letter: "G", connectorProvider: "GOOGLE" },
  tiktok_ads: { label: "TikTok Ads", color: "#000000", letter: "T", connectorProvider: "TIKTOK" },
};
