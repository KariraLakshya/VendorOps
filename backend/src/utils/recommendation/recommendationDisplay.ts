export type RecommendationDecision = "RECOMMENDED" | "BORDERLINE" | "NOT_RECOMMENDED";

/**
 * Presentation-only bucketing of an ALREADY-COMPUTED recommendation score
 * into the spec's three display buckets, for the hiring-manager UI badge.
 *
 * This is not the scoring engine — the score itself is produced entirely
 * by the Python AI Recommendation Agent (see the `agent` service) and
 * persisted as-is; this just re-applies the same published thresholds to
 * decide which label/color to render, so the API doesn't need to also
 * persist a separate decision column.
 */
export function bucketRecommendationScore(score: number): RecommendationDecision {
  if (score >= 0.75) return "RECOMMENDED";
  if (score >= 0.5) return "BORDERLINE";
  return "NOT_RECOMMENDED";
}
