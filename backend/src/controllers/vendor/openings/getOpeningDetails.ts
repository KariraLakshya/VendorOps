import type { Response } from "express";
import prisma from "../../../config/prisma/prisma.js";
import type { AuthenticatedRequest } from "../../../types/typeIndex.js";

/**
 * GET /api/v1/vendor/openings/:id
 *
 * Returns opening details plus the requesting vendor's OWN uploaded
 * profiles only — RBAC forbids a vendor from seeing another vendor's
 * uploads or any AI recommendation data, so both are excluded here rather
 * than filtered client-side.
 */
export async function getOpeningDetails(req: AuthenticatedRequest, res: Response): Promise<void> {
  const tenantId = req.user!.tenant.tenantId;
  const userId = req.user!.id;
  const { id } = req.params;

  const opening = await prisma.opening.findFirst({
    where: { id, tenantId },
  });

  if (!opening) {
    res.status(404).json({ error: "Opening not found" });
    return;
  }

  const hiringManager = await prisma.user.findUnique({
    where: { id: opening.hiringManagerId },
    select: { firstName: true, lastName: true, username: true },
  });
  const hiringManagerName =
    [hiringManager?.firstName, hiringManager?.lastName].filter(Boolean).join(" ") ||
    hiringManager?.username ||
    "Unknown";

  const [profilesCount, ownProfiles] = await Promise.all([
    prisma.hiringProfile.count({ where: { openingId: id, isDeleted: false } }),
    prisma.hiringProfile.findMany({
      where: { openingId: id, uploadedBy: userId, isDeleted: false },
      orderBy: { submittedAt: "desc" },
      select: {
        id: true,
        fileName: true,
        status: true,
        submittedAt: true,
        // Deliberately excludes every recommendation* field: vendors must
        // never see AI recommendation output.
      },
    }),
  ]);

  res.status(200).json({
    data: {
      id: opening.id,
      title: opening.title,
      description: opening.description,
      location: opening.location,
      contractType: opening.contractType,
      hiringManagerName,
      experienceRange: {
        min: opening.experienceMin,
        max: opening.experienceMax,
      },
      requiredSkills: opening.requiredSkills,
      status: opening.status,
      postedDate: opening.postedDate,
      profilesCount,
      uploadedProfiles: ownProfiles,
    },
  });
}
