import type { Response } from "express";
import prisma from "../../../config/prisma/prisma.js";
import type { AuthenticatedRequest } from "../../../types/typeIndex.js";

/**
 * GET /api/v1/vendor/openings
 *
 * Tenant-scoped, paginated list of contract openings. Every query in this
 * module filters by `tenantId` derived from the authenticated user's JWT
 * (never from a client-supplied parameter), which is what prevents
 * cross-tenant leakage regardless of what a caller puts in the URL.
 */
export async function getOpenings(req: AuthenticatedRequest, res: Response): Promise<void> {
  const tenantId = req.user!.tenant.tenantId;

  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 10));

  const [openings, total] = await Promise.all([
    prisma.opening.findMany({
      where: { tenantId },
      orderBy: { postedDate: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.opening.count({ where: { tenantId } }),
  ]);

  const hiringManagerIds = Array.from(new Set(openings.map((o) => o.hiringManagerId)));
  const hiringManagers = await prisma.user.findMany({
    where: { id: { in: hiringManagerIds } },
    select: { id: true, firstName: true, lastName: true, username: true },
  });
  const managerNameById = new Map(
    hiringManagers.map((m) => [m.id, [m.firstName, m.lastName].filter(Boolean).join(" ") || m.username || "Unknown"])
  );

  res.status(200).json({
    data: openings.map((opening) => ({
      id: opening.id,
      title: opening.title,
      location: opening.location,
      contractType: opening.contractType,
      postedDate: opening.postedDate,
      status: opening.status,
      hiringManagerName: managerNameById.get(opening.hiringManagerId) ?? "Unknown",
    })),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  });
}
