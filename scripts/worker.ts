/* eslint-disable no-console */
// Standalone background worker process. Run with `npm run worker`.
// Separate from the Next.js server because BullMQ workers are long-running
// processes, which doesn't fit the request/response lifecycle of Next.js
// route handlers/serverless functions.
import "dotenv/config";
import { startFollowUpWorker } from "../src/modules/followups/worker";
import { scheduleRepeatingFollowUpCheck } from "../src/modules/followups/queue";

async function main() {
  await scheduleRepeatingFollowUpCheck();
  startFollowUpWorker();
  console.log("Follow-up worker started. Checking for due follow-ups every 5 minutes.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
