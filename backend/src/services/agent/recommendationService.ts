import type { Opening, Prisma } from "@prisma/client";
import prisma from "../../config/prisma/prisma.js";
import { createStorageService } from "../storage/storageFactory.js";
import { detectResumeFormat, type SupportedResumeFormat } from "../../utils/resume/detectResumeFormat.js";
import { requestRecommendation } from "./agentServiceClient.js";
import { agentLogger } from "../../utils/logger/logger.js";
import { streamToBuffer } from "../../utils/stream/streamToBuffer.js";
import type { AgentOutput, RecommendationContext, RecommendationMetadata } from "../../types/agent.js";

type ProfileWithOpening = Prisma.hiringProfileGetPayload<{ include: { opening: true } }>;

/**
 * Recommendation Service.
 *
 * Sits between the controller (no business logic) and the AI
 * Recommendation Agent, which runs as a separate Python/FastAPI service
 * (the `agent` service). Responsible for:
 *  - fetching only the sanitized fields the agent needs (never handing the
 *    agent raw Prisma models),
 *  - retrieving the resume file from S3 (text extraction — PyMuPDF/
 *    python-pptx — and the vision fallback both live in the agent service
 *    now; this side just ships the bytes),
 *  - calling the agent service over HTTP,
 *  - persisting the result atomically, with idempotent re-run support.
 */
export async function processRecommendation(
  profileId: number,
  options: { force?: boolean } = {}
): Promise<void> {
  const startedAt = performance.now();

  const profile = await prisma.hiringProfile.findUnique({
    where: { id: profileId },
    include: { opening: true },
  });

  if (!profile || profile.isDeleted) {
    agentLogger.warn({ event: "recommendation_skipped", profileId }, "Profile not found or deleted");
    return;
  }

  if (!options.force && isAlreadyProcessed(profile)) {
    agentLogger.info(
      { event: "recommendation_skipped", profileId, status: profile.recommendationStatus },
      "Recommendation already computed or in progress; skipping (idempotent)"
    );
    return;
  }

  // Atomically claim the profile by flipping its status only if it's still
  // in a claimable state (PENDING/FAILED, or any state when forced). This
  // is the real guard against two concurrent triggers for the same
  // profile both passing the check above and racing to process it twice
  // — the check above is just a fast, non-transactional early exit.
  const claimed = await claimForProcessing(profileId, options.force ?? false);
  if (!claimed) {
    agentLogger.info(
      { event: "recommendation_skipped", profileId, reason: "lost_processing_claim" },
      "Another run already claimed this profile; skipping"
    );
    return;
  }

  agentLogger.info(
    { event: "recommendation_started", profileId, startTime: new Date().toISOString() },
    "Recommendation processing started"
  );

  try {
    const { resumeFileB64, fileFormat, context } = await prepareRecommendationInput(profile);

    const { output, metadata } = await requestRecommendation(resumeFileB64, fileFormat, context);

    await persistSuccess(profileId, output, metadata, startedAt);
  } catch (error) {
    await persistFailure(profileId, error as Error, startedAt);
  }
}

export function isAlreadyProcessed(profile: ProfileWithOpening): boolean {
  return profile.recommendationStatus === "COMPLETED" || profile.recommendationStatus === "PROCESSING";
}

const CLAIMABLE_STATUSES = ["PENDING", "FAILED"] as const;

/**
 * Flips a profile to PROCESSING only if it's still in a claimable state,
 * inside one transaction — an atomic compare-and-swap so at most one
 * concurrent call can "win" the right to process a given profile.
 * Returns whether this call won the claim.
 */
async function claimForProcessing(profileId: number, force: boolean): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.hiringProfile.updateMany({
      where: force ? { id: profileId } : { id: profileId, recommendationStatus: { in: [...CLAIMABLE_STATUSES] } },
      data: { recommendationStatus: "PROCESSING", recommendationError: null },
    });
    return count > 0;
  });
}

interface RecommendationInput {
  resumeFileB64: string;
  fileFormat: SupportedResumeFormat;
  context: RecommendationContext;
}

async function prepareRecommendationInput(profile: ProfileWithOpening): Promise<RecommendationInput> {
  const { buffer, format } = await fetchResumeFile(profile.s3Key, profile.fileName);

  return {
    resumeFileB64: buffer.toString("base64"),
    fileFormat: format,
    context: buildRecommendationContext(profile.opening),
  };
}

async function fetchResumeFile(
  s3Key: string,
  fileName: string
): Promise<{ buffer: Buffer; format: SupportedResumeFormat }> {
  const storageService = createStorageService();
  const stream = await storageService.getObjectStream(s3Key);
  const buffer = await streamToBuffer(stream);
  return { buffer, format: detectResumeFormat(fileName) };
}

export function buildRecommendationContext(opening: Opening): RecommendationContext {
  return {
    openingTitle: opening.title,
    requiredSkills: opening.requiredSkills,
    experienceMin: opening.experienceMin,
    experienceMax: opening.experienceMax,
    openingLocation: opening.location,
    contractType: opening.contractType,
  };
}

async function persistSuccess(
  profileId: number,
  output: AgentOutput,
  metadata: RecommendationMetadata,
  startedAt: number
): Promise<void> {
  const latencyMs = Math.round(performance.now() - startedAt);

  await persistRecommendationResult(profileId, {
    recommended: output.recommended,
    recommendationScore: output.score,
    recommendationConfidence: output.confidence,
    recommendationReason: output.reason,
    recommendationLatencyMs: latencyMs,
    recommendationVersion: metadata.agentVersion,
    recommendationStatus: "COMPLETED",
    recommendationError: null,
    recommendationMetadata: metadata,
    recommendedAt: new Date(),
  });

  agentLogger.info(
    { event: "recommendation_persisted", profileId, finalScore: output.score, latencyMs },
    "Recommendation persisted"
  );
}

async function persistFailure(profileId: number, error: Error, startedAt: number): Promise<void> {
  const latencyMs = Math.round(performance.now() - startedAt);

  agentLogger.error(
    { event: "recommendation_failed", profileId, error: error.message, latencyMs },
    "Recommendation processing failed"
  );

  await persistRecommendationResult(profileId, {
    recommendationStatus: "FAILED",
    recommendationError: error.message,
    recommendationLatencyMs: latencyMs,
  });
}

/**
 * All recommendation writes go through a single Prisma transaction call so
 * a crash mid-write can never leave a profile with a partially-written
 * recommendation (e.g. a score with no reason, or a stale PROCESSING
 * status).
 */
async function persistRecommendationResult(
  profileId: number,
  data: {
    recommended?: boolean;
    recommendationScore?: number;
    recommendationConfidence?: number;
    recommendationReason?: string;
    recommendationLatencyMs?: number;
    recommendationVersion?: string;
    recommendationStatus: "COMPLETED" | "FAILED";
    recommendationError?: string | null;
    recommendationMetadata?: RecommendationMetadata;
    recommendedAt?: Date;
  }
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.hiringProfile.update({
      where: { id: profileId },
      data: {
        ...data,
        recommendationMetadata: data.recommendationMetadata
          ? JSON.parse(JSON.stringify(data.recommendationMetadata))
          : undefined,
      },
    });
  });
}
