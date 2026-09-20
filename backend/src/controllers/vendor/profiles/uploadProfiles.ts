import type { Response } from "express";
import prisma from "../../../config/prisma/prisma.js";
import { FileUploadService } from "../../../services/upload/fileUploadService.js";
import { enqueueRecommendation } from "../../../services/agent/recommendationQueue.js";
import { agentLogger } from "../../../utils/logger/logger.js";
import type { AuthenticatedRequest, FileUploadResult } from "../../../types/typeIndex.js";

const fileUploadService = new FileUploadService();

interface TokenEntry {
  filename: string;
  uploadToken: string;
}

/**
 * POST /api/v1/vendor/openings/:id/profiles/upload
 *
 * Accepts the raw file bytes (multipart) together with the encrypted
 * upload tokens minted by the presign step, pushes each file to S3
 * server-side (the frontend never talks to S3 directly), and — only if
 * every file uploads successfully — atomically creates the corresponding
 * `hiringProfile` rows in a single Prisma transaction. Recommendation
 * processing is then enqueued (fire-and-forget, async) so this request
 * doesn't block on the AI pipeline.
 */
export async function uploadProfiles(req: AuthenticatedRequest, res: Response): Promise<void> {
  const tenantId = req.user!.tenant.tenantId;
  const userId = req.user!.id;
  const { id: openingId } = req.params;

  const opening = await prisma.opening.findFirst({ where: { id: openingId, tenantId } });
  if (!opening) {
    res.status(404).json({ error: "Opening not found" });
    return;
  }

  const files = (req.files as Express.Multer.File[]) ?? [];
  if (files.length === 0) {
    res.status(400).json({ error: "No files provided" });
    return;
  }

  const tokenEntries = parseUploadTokens(req.body.uploadTokens);
  if (!tokenEntries) {
    res.status(400).json({ error: "uploadTokens must be a JSON array of { filename, uploadToken }" });
    return;
  }

  const uploadResults = await uploadFilesToStorage(files, tokenEntries, { tenantId, openingId, userId });

  const failures = uploadResults.filter((result) => !result.success);
  if (failures.length > 0) {
    agentLogger.warn(
      { event: "profile_upload_failed", openingId, failures },
      "One or more profile uploads failed; rejecting the whole batch"
    );
    res.status(400).json({ error: "One or more files failed to upload; no profiles were created", details: failures });
    return;
  }

  const createdProfileIds = await createProfileRecords(uploadResults, { openingId, tenantId, userId });

  // Recommendation Trigger: automatic on SUBMITTED by IT_VENDOR. Enqueued
  // only after the transaction commits, and never awaited here.
  createdProfileIds.forEach((profileId) => enqueueRecommendation(profileId));

  res.status(201).json({
    message: "Profiles submitted successfully",
    data: { profileIds: createdProfileIds, count: createdProfileIds.length },
  });
}

function parseUploadTokens(raw: unknown): TokenEntry[] | null {
  try {
    return JSON.parse(typeof raw === "string" ? raw : "[]");
  } catch {
    return null;
  }
}

/**
 * Validates that an upload token was actually issued for this tenant,
 * opening, and vendor — preventing a token minted for one upload from
 * being replayed against another opening or on another vendor's behalf.
 */
function buildTokenValidator(tenantId: string, openingId: string, userId: string) {
  return (metadata: { tenantId: string; customFields?: Record<string, unknown> }) => {
    if (metadata.tenantId !== tenantId) {
      return { isValid: false, errorMessage: "Token tenant mismatch" };
    }
    if (metadata.customFields?.openingId !== openingId) {
      return { isValid: false, errorMessage: "Token opening mismatch" };
    }
    if (metadata.customFields?.uploadedBy !== userId) {
      return { isValid: false, errorMessage: "Token was not issued to this user" };
    }
    return { isValid: true };
  };
}

async function uploadFilesToStorage(
  files: Express.Multer.File[],
  tokenEntries: TokenEntry[],
  scope: { tenantId: string; openingId: string; userId: string }
): Promise<FileUploadResult[]> {
  const tokenByFilename = new Map(tokenEntries.map((entry) => [entry.filename, entry.uploadToken]));
  const validateTokenFn = buildTokenValidator(scope.tenantId, scope.openingId, scope.userId);

  return Promise.all(
    files.map((file) => {
      const uploadToken = tokenByFilename.get(file.originalname);
      if (!uploadToken) {
        return { key: "", filename: file.originalname, success: false, errorMessage: "No matching upload token" };
      }
      return fileUploadService.uploadFile(
        { fileBuffer: file.buffer, mimeType: file.mimetype, uploadToken },
        { validateTokenFn }
      );
    })
  );
}

async function createProfileRecords(
  uploadResults: FileUploadResult[],
  scope: { openingId: string; tenantId: string; userId: string }
): Promise<number[]> {
  return prisma.$transaction(async (tx) => {
    const ids: number[] = [];
    for (const result of uploadResults) {
      const created = await tx.hiringProfile.create({
        data: {
          openingId: scope.openingId,
          tenantId: scope.tenantId,
          s3Key: result.key,
          fileName: result.filename,
          uploadedBy: scope.userId,
          status: "SUBMITTED",
          recommendationStatus: "PENDING",
        },
      });
      ids.push(created.id);
    }
    return ids;
  });
}
