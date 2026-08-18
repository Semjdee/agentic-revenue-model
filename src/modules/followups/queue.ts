import { Queue } from "bullmq";
import IORedis from "ioredis";

// Background jobs (spec section 25: "BullMQ or equivalent. Background jobs
// handle: follow-ups, webhook delivery, integration sync"). Follow-ups are
// the canonical example wired to a real queue; see BUILD_NOTES.md for which
// other jobs are still synchronous in this MVP.
const connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

export const followUpQueue = new Queue("followups", { connection });

export async function scheduleRepeatingFollowUpCheck() {
  await followUpQueue.upsertJobScheduler(
    "check-due-followups",
    { every: 5 * 60 * 1000 }, // every 5 minutes
    { name: "check-due-followups" }
  );
}

export { connection as redisConnection };
