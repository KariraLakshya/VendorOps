import { Router } from "express";
import { authenticateUser } from "../../middlewares/auth/authenticateMiddleware.js";
import { requireRole } from "../../middlewares/auth/requireRole.js";
import asyncHandler from "../../utils/handler/asyncHandler.js";
import { deleteProfile } from "../../controllers/vendor/profiles/deleteProfile.js";
import { previewProfile } from "../../controllers/vendor/profiles/previewProfile.js";

const router = Router();

router.use(authenticateUser, requireRole("IT_VENDOR"));

router.get("/:profileId/preview", asyncHandler(previewProfile));
router.delete("/:profileId", asyncHandler(deleteProfile));

export default router;
