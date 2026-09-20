import { Router } from "express";
import { authenticateUser } from "../../middlewares/auth/authenticateMiddleware.js";
import { requireRole } from "../../middlewares/auth/requireRole.js";
import { profileUploadConfig } from "../../config/multer/profileUploadConfig.js";
import { profileUploadRateLimiter } from "../../middlewares/rateLimit/rateLimiters.js";
import asyncHandler from "../../utils/handler/asyncHandler.js";
import { getOpenings } from "../../controllers/vendor/openings/getOpenings.js";
import { getOpeningDetails } from "../../controllers/vendor/openings/getOpeningDetails.js";
import { presignProfiles } from "../../controllers/vendor/profiles/presignProfiles.js";
import { uploadProfiles } from "../../controllers/vendor/profiles/uploadProfiles.js";

const router = Router();

router.use(authenticateUser, requireRole("IT_VENDOR"));

router.get("/", asyncHandler(getOpenings));
router.get("/:id", asyncHandler(getOpeningDetails));
router.post("/:id/profiles/presign", asyncHandler(presignProfiles));
router.post(
  "/:id/profiles/upload",
  profileUploadRateLimiter,
  profileUploadConfig.array("files"),
  asyncHandler(uploadProfiles)
);

export default router;
