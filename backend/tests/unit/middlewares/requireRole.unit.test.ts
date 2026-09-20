import { describe, it, expect, vi } from "vitest";
import { requireRole } from "../../../src/middlewares/auth/requireRole";

function mockRes() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe("requireRole (RBAC — unauthorized access tests)", () => {
  it("rejects unauthenticated requests with 401", () => {
    const req: any = {};
    const res = mockRes();
    const next = vi.fn();

    requireRole("IT_VENDOR")(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a wrong-role user with 403", () => {
    const req: any = {
      user: { id: "u1", role: "HIRING_MANAGER", tenant: { tenantId: "t1" } },
    };
    const res = mockRes();
    const next = vi.fn();

    requireRole("IT_VENDOR")(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a user with no tenant association", () => {
    const req: any = { user: { id: "u1", role: "IT_VENDOR", tenant: null } };
    const res = mockRes();
    const next = vi.fn();

    requireRole("IT_VENDOR")(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("allows a correctly-roled, tenant-scoped user through", () => {
    const req: any = {
      user: { id: "u1", role: "IT_VENDOR", tenant: { tenantId: "t1" } },
    };
    const res = mockRes();
    const next = vi.fn();

    requireRole("IT_VENDOR")(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("accepts any role in an allow-list", () => {
    const req: any = {
      user: { id: "u1", role: "HIRING_MANAGER", tenant: { tenantId: "t1" } },
    };
    const res = mockRes();
    const next = vi.fn();

    requireRole("IT_VENDOR", "HIRING_MANAGER")(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });
});
