// DEMO/MOCK CONNECTOR for Google Search Console (organic search). Kept
// deliberately separate from AdsConnector (src/integrations/advertising/) —
// organic search has no spend, no campaign, no budget to approve, just a
// property's impressions/clicks/ranking/queries. Forcing it through the
// paid-ads shape would mean fake spend numbers for a channel that costs
// nothing to run, which is worse than just modeling it honestly as its
// own thing.

export interface OrganicSearchSnapshot {
  date: string; // YYYY-MM-DD
  impressions: number;
  clicks: number;
  avgPosition: number;
  topQueries: { query: string; clicks: number; impressions: number }[];
}

export interface OrganicSearchConnector {
  readonly isMock: boolean;
  authenticate(credentials: Record<string, unknown>): Promise<{ ok: boolean }>;
  testConnection(): Promise<{ ok: boolean; detail?: string }>;
  getSnapshots(days: number): Promise<OrganicSearchSnapshot[]>;
}

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

const QUERY_POOL = [
  "solar panels uganda",
  "residential solar installation kampala",
  "solar system price uganda",
  "hybrid solar inverter",
  "solar financing uganda",
  "best solar company kampala",
  "solar battery backup",
  "off grid solar system cost",
];

export class MockSearchConsoleConnector implements OrganicSearchConnector {
  readonly isMock = true;

  async authenticate() {
    return { ok: true };
  }

  async testConnection(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: true };
  }

  async getSnapshots(days: number, propertySeed = "raygrid-property"): Promise<OrganicSearchSnapshot[]> {
    const snapshots: OrganicSearchSnapshot[] = [];
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().slice(0, 10);
      const rand = seededRandom(`${propertySeed}:${dateStr}`);
      const impressions = Math.round(200 + rand() * 500);
      const clicks = Math.round(impressions * (0.02 + rand() * 0.06));
      const avgPosition = Math.round((8 + rand() * 15) * 10) / 10;

      const queries = [...QUERY_POOL].sort(() => rand() - 0.5).slice(0, 4);
      const topQueries = queries.map((q) => {
        const qImpr = Math.round(20 + rand() * 80);
        return { query: q, impressions: qImpr, clicks: Math.round(qImpr * (0.03 + rand() * 0.08)) };
      });

      snapshots.push({ date: dateStr, impressions, clicks, avgPosition, topQueries });
    }
    return snapshots;
  }
}

export function getOrganicSearchConnector(): OrganicSearchConnector {
  return new MockSearchConsoleConnector();
}
