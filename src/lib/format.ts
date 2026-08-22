// Shared formatting helpers — UI/UX Modernization doc §10: "compact
// currency" (UGX 500K / UGX 1.2M / UGX 18.7M / UGX 1.4B), never a raw
// unformatted number like "18700000". Safe to use from both server
// (route handlers building AI Revenue Brief text) and client components —
// pure functions, no DOM dependency.

export function formatCompactCurrency(amount: number, currency = "UGX"): string {
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  let compact: string;
  if (abs >= 1_000_000_000) compact = trimZero(abs / 1_000_000_000) + "B";
  else if (abs >= 1_000_000) compact = trimZero(abs / 1_000_000) + "M";
  else if (abs >= 1_000) compact = trimZero(abs / 1_000) + "K";
  else compact = Math.round(abs).toLocaleString();
  return `${sign}${currency} ${compact}`;
}

function trimZero(n: number): string {
  // One decimal place, but "18.0M" -> "18M" — matches the doc's own
  // examples ("UGX 500K", not "UGX 500.0K").
  const rounded = Math.round(n * 10) / 10;
  return rounded % 1 === 0 ? String(rounded) : rounded.toFixed(1);
}

/** Percentage change vs a prior value — null when the prior value is 0
 * (no meaningful percentage) or either value is not yet known, so the UI
 * can honestly omit the trend rather than show a fabricated "+Infinity%"
 * or "0%". */
export function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}
