import type { Response } from "express";
import prisma from "../../../config/prisma/prisma.js";
import type { AuthenticatedRequest } from "../../../types/typeIndex.js";

/**
 * GET /api/v1/hiring-manager/openings
 * Only the caller's own openings — scoped by tenant AND hiringManagerId.
 */
export async function getOpenings(req: AuthenticatedRequest, res: Response): Promise<void> {
  const tenantId = req.user!.tenant.tenantId;
  const hiringManagerId = req.user!.id;

  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 10));

  const [openings, total] = await Promise.all([
    prisma.opening.findMany({
      where: { tenantId, hiringManagerId },
      orderBy: { postedDate: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { _count: { select: { hiringProfiles: { where: { isDeleted: false } } } } },
    }),
    prisma.opening.count({ where: { tenantId, hiringManagerId } }),
  ]);

  res.status(200).json({
    data: openings.map((opening) => ({
      id: opening.id,
      title: opening.title,
      location: opening.location,
      contractType: opening.contractType,
      postedDate: opening.postedDate,
      status: opening.status,
      experienceRange: { min: opening.experienceMin, max: opening.experienceMax },
      profilesCount: opening._count.hiringProfiles,
    })),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  });
}
