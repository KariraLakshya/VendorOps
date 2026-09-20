import type { Response } from "express";
import prisma from "../../../config/prisma/prisma.js";
import { createStorageService } from "../../../services/storage/storageFactory.js";
import type { AuthenticatedRequest } from "../../../types/typeIndex.js";

const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/**
 * GET /api/v1/vendor/profiles/:profileId/preview
 *
 * Streams a candidate profile file back through the backend rather than
 * handing the client a (signed or unsigned) S3 URL directly — the spec's
 * "file preview via backend" requirement, and consistent with "no
 * frontend → direct S3 access" everywhere else in this module.
 */
export async function previewProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
  const tenantId = req.user!.tenant.tenantId;
  const userId = req.user!.id;
  const profileId = Number(req.params.profileId);

  if (!Number.isInteger(profileId)) {
    res.status(400).json({ error: "Invalid profile id" });
    return;
  }

  const profile = await prisma.hiringProfile.findFirst({
    where: { id: profileId, tenantId, uploadedBy: userId, isDeleted: false },
  });

  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }

  const storageService = createStorageService();
  const stream = await storageService.getObjectStream(profile.s3Key);

  const ext = profile.fileName.split(".").pop()?.toLowerCase() ?? "";
  res.setHeader("Content-Type", CONTENT_TYPES[ext] ?? "application/octet-stream");
  res.setHeader("Content-Disposition", `inline; filename="${profile.fileName}"`);

  stream.on("error", () => res.status(500).end());
  stream.pipe(res);
}
