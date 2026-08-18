// Netlify Scheduled Function — replaces the persistent BullMQ worker for
// the follow-up engine when this app is deployed on Netlify (see
// netlify.toml and BUILD_NOTES.md -> "Deploying to Netlify").
//
// Runs every 5 minutes (matching the interval `scheduleRepeatingFollowUpCheck()`
// uses for the BullMQ version — src/modules/followups/queue.ts) and calls the
// exact same `runFollowUpCheck()` used by the worker, the demo-journey
// script, and the manual "Run follow-up check now" button in Settings, so
// behavior is identical regardless of which scheduler is invoking it.
//
// NOT YET DEPLOYED/VERIFIED from inside the build sandbox this project was
// created in (no outbound network access to api.netlify.com there — see
// BUILD_NOTES.md). Path-aliased imports (`@/...`) rely on Netlify's esbuild
// function bundler picking up tsconfig.json's `paths` mapping automatically;
// confirm this resolves cleanly on your first deploy, and switch the imports
// below to relative paths if it doesn't.
import type { Config } from "@netlify/functions";
import { runFollowUpCheck } from "../../src/modules/followups/processor";

export default async () => {
  const results = await runFollowUpCheck();
  if (results.length) {
    // eslint-disable-next-line no-console
    console.log(`[followups-cron] processed ${results.length} due follow-up(s)`);
  }
  return new Response(JSON.stringify({ processed: results.length }), {
    headers: { "content-type": "application/json" },
  });
};

export const config: Config = {
  schedule: "*/5 * * * *",
};
