import express from "express";
import vendorRequestRoutes from "./vendorRequestRoutes.js";
import openingRoutes from "./openingRoutes.js";
import profileRoutes from "./profileRoutes.js";

const router = express.Router();

/**
 * @route /vendor/requests
 */
router.use("/requests", vendorRequestRoutes);

/**
 * @route /vendor/openings
 */
router.use("/openings", openingRoutes);

/**
 * @route /vendor/profiles
 */
router.use("/profiles", profileRoutes);

export default router;
