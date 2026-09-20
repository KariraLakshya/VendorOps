import type { Response } from "express";
import prisma from "../../../config/prisma/prisma.js";
import { bucketRecommendationScore } from "../../../utils/recommendation/recommendationDisplay.js";
import type { AuthenticatedRequest } from "../../../types/typeIndex.js";

/**
 * GET /api/v1/hiring-manager/openings/:id/profiles
 *
 * Enforces `opening.hiringManagerId === loggedInUser.id` — a hiring
 * manager can never list profiles for an opening they don't own, even
 * within their own tenant.
 */
export async function getProfiles(req: AuthenticatedRequest, res: Response): Promise<void> {
  const tenantId = req.user!.tenant.tenantId;
  const hiringManagerId = req.user!.id;
  const { id: openingId } = req.params;

  const opening = await prisma.opening.findFirst({
    where: { id: openingId, tenantId, hiringManagerId },
  });

  if (!opening) {
    res.status(404).json({ error: "Opening not found" });
    return;
  }

  const profiles = await prisma.hiringProfile.findMany({
    where: { openingId, isDeleted: false },
    orderBy: { submittedAt: "desc" },
  });

  res.status(200).json({
    data: profiles.map((profile) => ({
      id: profile.id,
      fileName: profile.fileName,
      submittedAt: profile.submittedAt,
      status: profile.status,
      recommendationStatus: profile.recommendationStatus,
      recommendationError: profile.recommendationError,
      recommendation:
        profile.recommendationStatus === "COMPLETED"
          ? {
              recommended: profile.recommended,
              decision:
                profile.recommendationScore != null
                  ? bucketRecommendationScore(profile.recommendationScore)
                  : null,
              score: profile.recommendationScore,
              confidence: profile.recommendationConfidence,
              reason: profile.recommendationReason,
              latencyMs: profile.recommendationLatencyMs,
              processedAt: profile.recommendedAt,
              usedVisionFallback:
                (profile.recommendationMetadata as { usedVisionFallback?: boolean } | null)
                  ?.usedVisionFallback ?? false,
            }
          : null,
    })),
  });
}
