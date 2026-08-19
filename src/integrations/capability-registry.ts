// Channel capability registry — docs/PHASE_2_EXTENSIONS_SPEC.md section 14
// / docs/ONBOARDING_SPEC.md's Integration Permission Centre. Lets the
// platform (and the UI) know exactly what each integration supports,
// rather than assuming every social network behaves like WhatsApp.

export const PROVIDER_CAPABILITIES = [
  "MESSAGING_RECEIVE",
  "MESSAGING_SEND",
  "LEAD_CAPTURE",
  "ADVERTISING_READ",
  "ADVERTISING_WRITE",
  "ORGANIC_ANALYTICS",
  "CONTENT_PUBLISH",
  "WEBHOOKS",
  "ATTRIBUTION",
] as const;

export type ProviderCapability = (typeof PROVIDER_CAPABILITIES)[number];

/** What each provider actually supports, once fully connected with the
 * scopes below granted. The Integration Permission Centre cross-references
 * a connection's *actual* granted `scopes` against this — never renders a
 * checkmark just because the provider is capable in general. */
export const PROVIDER_CAPABILITY_MAP: Record<string, ProviderCapability[]> = {
  whatsapp: ["MESSAGING_RECEIVE", "MESSAGING_SEND", "LEAD_CAPTURE", "WEBHOOKS", "ATTRIBUTION"],
  instagram: ["MESSAGING_RECEIVE", "MESSAGING_SEND", "ORGANIC_ANALYTICS", "CONTENT_PUBLISH", "WEBHOOKS", "ATTRIBUTION"],
  tiktok: ["ADVERTISING_READ", "ADVERTISING_WRITE", "LEAD_CAPTURE", "ORGANIC_ANALYTICS", "CONTENT_PUBLISH", "ATTRIBUTION"],
};

/** Least-privilege default scope request per provider (spec section 7 —
 * "request only permissions necessary for the feature the customer is
 * activating"). WhatsApp's onboarding flow starts with messaging only;
 * marketing-broadcast scope, if ever added, would be requested separately
 * later, not bundled in up front. */
export const PROVIDER_DEFAULT_SCOPES: Record<string, string[]> = {
  whatsapp: ["whatsapp_business_messaging", "whatsapp_business_management"],
  // Instagram self-service connection (docs/ONBOARDING_SPEC.md section 8) —
  // messaging + basic profile only to start; content publishing isn't
  // requested until a feature that needs it actually ships (least-privilege
  // scopes, spec section 7 — don't request more than the current feature
  // set uses).
  instagram: ["instagram_business_basic", "instagram_business_manage_messages"],
};
