// Industry taxonomy — Industry Team Subscription Architecture doc, Part A.
// Replaces the free-text `tenants.industry` field with a real validated
// list so it can actually key into `industry_templates` (see
// industry-templates.ts) instead of being decorative text only
// health-check.ts's businessProfileOk boolean ever reads. The doc's own
// 13 named verticals plus "Other" — not invented here.

export const INDUSTRY_CATEGORIES = [
  "SOLAR",
  "REAL_ESTATE",
  "AUTOMOTIVE",
  "TRAVEL",
  "EDUCATION",
  "MANUFACTURING",
  "ECOMMERCE",
  "PROFESSIONAL_SERVICES",
  "RETAIL",
  "HOSPITALITY",
  "HEALTHCARE",
  "FINANCIAL_SERVICES",
  "TECHNOLOGY",
  "OTHER",
] as const;

export type IndustryCategory = (typeof INDUSTRY_CATEGORIES)[number];

export const INDUSTRY_LABELS: Record<IndustryCategory, string> = {
  SOLAR: "Solar & Renewable Energy",
  REAL_ESTATE: "Real Estate",
  AUTOMOTIVE: "Automotive",
  TRAVEL: "Travel & Tourism",
  EDUCATION: "Education",
  MANUFACTURING: "Manufacturing",
  ECOMMERCE: "E-commerce",
  PROFESSIONAL_SERVICES: "Professional Services",
  RETAIL: "Retail",
  HOSPITALITY: "Hospitality",
  HEALTHCARE: "Healthcare",
  FINANCIAL_SERVICES: "Financial Services",
  TECHNOLOGY: "Technology",
  OTHER: "Other",
};

export function isIndustryCategory(value: string): value is IndustryCategory {
  return (INDUSTRY_CATEGORIES as readonly string[]).includes(value);
}
