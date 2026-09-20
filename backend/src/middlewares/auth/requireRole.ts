import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../../types/typeIndex.js";

/**
 * Role-gate for the contract hiring module.
 *
 * Unlike `authorizeMiddleware.ts` (which re-verifies the raw JWT against
 * Keycloak realm roles), this checks the DB-backed role already resolved
 * onto `req.user` by `authenticateUser`. That's the same role/tenant data
 * every tenant-scoped query in this module uses, so there's no way for a
 * request to pass this gate with a role/tenant that the query layer
 * disagrees with.
 */
export function requireRole(...allowedRoles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ status: "error", error: "Authentication required" });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        status: "error",
        error: `Access denied: requires one of [${allowedRoles.join(", ")}]`,
      });
      return;
    }

    if (!req.user.tenant?.tenantId) {
      res.status(403).json({ status: "error", error: "User is not associated with a tenant" });
      return;
    }

    next();
  };
}
