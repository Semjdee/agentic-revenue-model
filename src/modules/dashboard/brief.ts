import { formatCompactCurrency } from "@/lib/format";

// AI Revenue Brief — UI/UX Modernization doc §8: "must ultimately use
// actual platform data. Do not hardcode conclusions."
//
// Deliberately a DETERMINISTIC, templated summary over real computed
// dashboard numbers — not a live LLM call. This platform's own established
// split ("platform calculates, AI interprets" — see AIExecutionGateway/
// execution-gateway.ts) already treats a real LLM call as something that
// consumes AI credits and goes through the gateway's hard limits/audit
// trail; a dashboard summary that refreshes on every page load doesn't
// warrant that cost or complexity, and this file's job — turning already-
// correct numbers into a sentence — has no ambiguity an LLM would resolve
// better. Every sentence here is built from a real number computed by the
// dashboard route; nothing is invented, and a bullet is simply omitted
// when its underlying condition doesn't hold (never a filler sentence).
export interface RevenueBriefInput {
  currency: string;
  revenue: number;
  revenueTrendPct: number | null;
  topQualifiedChannel: { channel: string; qualified: number } | null;
  topConversionChannel: { channel: string; conversionPct: number } | null;
  quotationsPendingCount: number;
  quotationsPendingValue: number;
  underperformingCampaigns: number;
}

export interface RevenueBrief {
  headline: string;
  bullets: string[];
}

function channelLabel(channel: string): string {
  const labels: Record<string, string> = { WEBSITE: "the website widget", WHATSAPP: "WhatsApp", INSTAGRAM: "Instagram", MESSENGER: "Messenger" };
  return labels[channel] ?? channel;
}

export function generateRevenueBrief(input: RevenueBriefInput): RevenueBrief {
  const fmt = (n: number) => formatCompactCurrency(n, input.currency);
  const bullets: string[] = [];

  let headline: string;
  if (input.revenueTrendPct === null) {
    headline = `Revenue is ${fmt(input.revenue)} for the selected period.`;
  } else if (input.revenueTrendPct >= 0) {
    headline = `Revenue increased ${Math.abs(input.revenueTrendPct).toFixed(0)}% during the selected period, to ${fmt(input.revenue)}.`;
  } else {
    headline = `Revenue is down ${Math.abs(input.revenueTrendPct).toFixed(0)}% during the selected period, to ${fmt(input.revenue)}.`;
  }

  if (input.topQualifiedChannel && input.topConversionChannel && input.topQualifiedChannel.channel !== input.topConversionChannel.channel) {
    bullets.push(
      `${channelLabel(input.topQualifiedChannel.channel)} generated the most qualified leads, while ${channelLabel(input.topConversionChannel.channel)} produced the highest sales conversion rate.`
    );
  } else if (input.topQualifiedChannel) {
    bullets.push(`${channelLabel(input.topQualifiedChannel.channel)} generated the most qualified leads this period.`);
  }

  if (input.quotationsPendingCount > 0) {
    bullets.push(
      `${input.quotationsPendingCount} quotation${input.quotationsPendingCount === 1 ? "" : "s"} worth ${fmt(input.quotationsPendingValue)} require${input.quotationsPendingCount === 1 ? "s" : ""} follow-up.`
    );
  }

  if (input.underperformingCampaigns > 0) {
    bullets.push(`${input.underperformingCampaigns} campaign${input.underperformingCampaigns === 1 ? " is" : "s are"} below target ROAS.`);
  }

  return { headline, bullets };
}
