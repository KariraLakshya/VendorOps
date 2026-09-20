import type { Response } from "express";
import prisma from "../../../config/prisma/prisma.js";
import type { AuthenticatedRequest } from "../../../types/typeIndex.js";

type DecisionOutcome =
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "ok"; id: number; status: "SHORTLISTED" | "REJECTED" };

/**
 * Shared implementation for shortlist/reject — both endpoints enforce the
 * same mandatory ownership condition:
 *   opening.hiringManagerId === loggedInUser.id
 *
 * The ownership check and the write happen inside one Prisma transaction
 * so there's no gap between "is this still this manager's profile" and
 * "apply the decision" — e.g. a concurrent soft-delete of the profile
 * can't sneak in between the two.
 */
async function decideProfile(
  req: AuthenticatedRequest,
  res: Response,
  targetStatus: "SHORTLISTED" | "REJECTED"
): Promise<void> {
  const tenantId = req.user!.tenant.tenantId;
  const hiringManagerId = req.user!.id;
  const profileId = Number(req.params.profileId);

  if (!Number.isInteger(profileId)) {
    res.status(400).json({ error: "Invalid profile id" });
    return;
  }

  const outcome = await applyDecision(profileId, tenantId, hiringManagerId, targetStatus);

  if (outcome.kind === "not_found") {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  if (outcome.kind === "forbidden") {
    res.status(403).json({ error: "You do not own the opening this profile belongs to" });
    return;
  }

  res.status(200).json({
    message: `Profile ${outcome.status.toLowerCase()}`,
    data: { id: outcome.id, status: outcome.status },
  });
}

async function applyDecision(
  profileId: number,
  tenantId: string,
  hiringManagerId: string,
  targetStatus: "SHORTLISTED" | "REJECTED"
): Promise<DecisionOutcome> {
  const now = new Date();

  return prisma.$transaction(async (tx): Promise<DecisionOutcome> => {
    const profile = await tx.hiringProfile.findFirst({
      where: { id: profileId, tenantId, isDeleted: false },
      include: { opening: true },
    });

    if (!profile) return { kind: "not_found" };
    if (profile.opening.hiringManagerId !== hiringManagerId) return { kind: "forbidden" };

    const updated = await tx.hiringProfile.update({
      where: { id: profileId },
      data:
        targetStatus === "SHORTLISTED"
          ? { status: "SHORTLISTED", shortlistedBy: hiringManagerId, shortlistedAt: now }
          : { status: "REJECTED", rejectedBy: hiringManagerId, rejectedAt: now },
    });

    return { kind: "ok", id: updated.id, status: updated.status as "SHORTLISTED" | "REJECTED" };
  });
}

export const shortlistProfile = (req: AuthenticatedRequest, res: Response) =>
  decideProfile(req, res, "SHORTLISTED");

export const rejectProfile = (req: AuthenticatedRequest, res: Response) =>
  decideProfile(req, res, "REJECTED");
