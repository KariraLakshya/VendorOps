import type { Response } from "express";
import prisma from "../../../config/prisma/prisma.js";
import { FilePresignService } from "../../../services/upload/filePresignService.js";
import type { AuthenticatedRequest } from "../../../types/typeIndex.js";

const filePresignService = new FilePresignService();
const ALLOWED_EXTENSIONS = [".pdf", ".pptx"];

/**
 * POST /api/v1/vendor/openings/:id/profiles/presign
 *
 * Generates encrypted, short-lived upload tokens (never a raw S3 URL) for
 * each requested filename. S3 keys follow the mandated layout:
 * <bucket>/<tenantId>/<openingId>/<timestamp>_<filename>
 */
export async function presignProfiles(req: AuthenticatedRequest, res: Response): Promise<void> {
  const tenantId = req.user!.tenant.tenantId;
  const { id: openingId } = req.params;
  const { filenames } = req.body as { filenames?: string[] };

  if (!Array.isArray(filenames) || filenames.length === 0) {
    res.status(400).json({ error: "filenames must be a non-empty array" });
    return;
  }

  const invalid = filenames.filter(
    (name) => !ALLOWED_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext))
  );
  if (invalid.length > 0) {
    res.status(400).json({ error: `Unsupported file type(s): ${invalid.join(", ")}. Only PDF and PPTX are allowed.` });
    return;
  }

  const opening = await prisma.opening.findFirst({ where: { id: openingId, tenantId } });
  if (!opening) {
    res.status(404).json({ error: "Opening not found" });
    return;
  }

  const uploadTokens = await filePresignService.generateUploadTokens(filenames, {
    tenantId,
    s3KeyConfig: {
      pathSegments: ["contract-uploads", tenantId, openingId],
      includeTimestamp: true,
    },
    uploadEndpoint: `/api/v1/vendor/openings/${openingId}/profiles/upload`,
    customMetadata: { openingId, uploadedBy: req.user!.id },
  });

  res.status(200).json({ data: uploadTokens });
}
