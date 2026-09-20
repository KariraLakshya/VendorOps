import pLimit from "p-limit";
import { processRecommendation } from "./recommendationService.js";
import { agentLogger } from "../../utils/logger/logger.js";

/**
 * Bounded in-process async task runner for recommendation processing.
 *
 * The spec requires the upload/submit API to never block on the AI
 * pipeline (max processing time per profile 1500ms, no blocking API call
 * over 2s). Rather than making the HTTP request wait on the LLM agent, the
 * vendor "submit profiles" endpoint enqueues each profile here and returns
 * immediately once the DB transaction committing the SUBMITTED profiles
 * succeeds; this module drains the queue with bounded concurrency so we
 * don't blow through Groq rate limits under bulk uploads.
 *
 * This is an in-process queue, not a durable broker (no Redis/BullMQ
 * dependency) — acceptable for this assignment's scope, and swappable
 * behind this same enqueue() call if a durable queue is introduced later.
 */
const concurrency = Number(process.env.RECOMMENDATION_CONCURRENCY ?? 4);
const limit = pLimit(concurrency);

export function enqueueRecommendation(profileId: number): void {
  void limit(async () => {
    try {
      await processRecommendation(profileId);
    } catch (error) {
      agentLogger.error(
        { event: "recommendation_queue_error", profileId, error: (error as Error).message },
        "Unhandled error while processing queued recommendation"
      );
    }
  });
}
