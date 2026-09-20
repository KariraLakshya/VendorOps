import { Router } from "express";
import { authenticateUser } from "../../middlewares/auth/authenticateMiddleware.js";
import { requireRole } from "../../middlewares/auth/requireRole.js";
import asyncHandler from "../../utils/handler/asyncHandler.js";
import { getOpenings } from "../../controllers/hiringManager/openings/getOpenings.js";
import { getProfiles } from "../../controllers/hiringManager/openings/getProfiles.js";
import {
  shortlistProfile,
  rejectProfile,
} from "../../controllers/hiringManager/profiles/decideProfile.js";

const router = Router();

router.use(authenticateUser, requireRole("HIRING_MANAGER"));

/**
 * GET /api/v1/hiring-manager/openings
 * @requires HIRING_MANAGER role
 */
router.get("/openings", asyncHandler(getOpenings));

/**
 * GET /api/v1/hiring-manager/openings/:id/profiles
 */
router.get("/openings/:id/profiles", asyncHandler(getProfiles));

/**
 * POST /api/v1/hiring-manager/profiles/:profileId/shortlist
 */
router.post("/profiles/:profileId/shortlist", asyncHandler(shortlistProfile));

/**
 * POST /api/v1/hiring-manager/profiles/:profileId/reject
 */
router.post("/profiles/:profileId/reject", asyncHandler(rejectProfile));

export default router;
