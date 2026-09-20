import type { Response } from "express";
import prisma from "../../../config/prisma/prisma.js";
import type { AuthenticatedRequest } from "../../../types/typeIndex.js";

/**
 * DELETE /api/v1/vendor/profiles/:profileId
 *
 * Soft delete only. A vendor may delete only their own uploads — ownership
 * (`uploadedBy`) and tenant are both checked, so an ID guessed from
 * another tenant or vendor is a 404, not a 403 (no existence leakage).
 */
export async function deleteProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
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

  await prisma.hiringProfile.update({
    where: { id: profileId },
    data: { isDeleted: true, deletedAt: new Date() },
  });

  res.status(200).json({ message: "Profile deleted" });
}
