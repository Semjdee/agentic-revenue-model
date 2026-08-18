import { Worker } from "bullmq";
import { redisConnection } from "./queue";
import { runFollowUpCheck } from "./processor";

export function startFollowUpWorker() {
  const worker = new Worker(
    "followups",
    async () => {
      const results = await runFollowUpCheck();
      if (results.length) {
        // eslint-disable-next-line no-console
        console.log(`[followups] processed ${results.length} due follow-up(s)`);
      }
      return results;
    },
    { connection: redisConnection }
  );

  worker.on("failed", (job, err) => {
    // eslint-disable-next-line no-console
    console.error("[followups] job failed", job?.id, err);
  });

  return worker;
}
