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

// If this repo is ALSO deployed as a second, admin-only site
// (ADMIN_HOSTNAME split — see src/middleware.ts), that site would
// otherwise run this exact same scheduled function on its own 5-minute
// timer too — the schedule is a Netlify-site-level config, not something
// the app's own request routing can gate the way middleware gates page/
// API requests. Two independent crons hitting the same due opportunities
// is a real double-send risk, not a hypothetical one, so this function
// skips entirely on any deploy whose own URL matches ADMIN_HOSTNAME.
// `URL` is set automatically by Netlify to the site's own canonical
// address (https://docs.netlify.com/configure-builds/environment-variables/).
function isAdminSite(): boolean {
  const adminHostname = process.env.ADMIN_HOSTNAME;
  const ownUrl = process.env.URL;
  if (!adminHostname || !ownUrl) return false;
  try {
    return new URL(ownUrl).host === adminHostname;
  } catch {
    return false;
  }
}

export default async () => {
  if (isAdminSite()) {
    return new Response(JSON.stringify({ skipped: "admin site — follow-up processing runs on the main site only" }), {
      headers: { "content-type": "application/json" },
    });
  }

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
