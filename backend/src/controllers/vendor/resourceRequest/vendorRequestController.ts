import { fetchRequestData as fetchRequestDataImpl } from "./requests/getVendorRequests.js";
import { Request, Response } from "express";

/**
 * Handles vendor requests with error handling and response formatting.
 * @param req Express request
 * @param res Express response
 */
export const fetchRequestData = async (req: Request, res: Response) => {
  try {
    await fetchRequestDataImpl(req, res);
  } catch (error) {
    res.status(500).json({
      status: "error",
      error: "Internal server error",
      details: (error as Error).message,
    });
  }
};
