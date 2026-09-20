import { describe, it, expect, vi, beforeEach } from "vitest";

const { findManyMock, countMock, userFindManyMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  countMock: vi.fn(),
  userFindManyMock: vi.fn(),
}));

vi.mock("../../../../src/config/prisma/prisma", () => ({
  default: {
    opening: { findMany: findManyMock, count: countMock },
    user: { findMany: userFindManyMock },
  },
}));

import { getOpenings } from "../../../../src/controllers/vendor/openings/getOpenings";

function mockRes() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe("Vendor getOpenings — tenant leakage tests", () => {
  beforeEach(() => {
    findManyMock.mockReset();
    countMock.mockReset();
    userFindManyMock.mockReset();
    findManyMock.mockResolvedValue([]);
    countMock.mockResolvedValue(0);
    userFindManyMock.mockResolvedValue([]);
  });

  it("scopes the Prisma query strictly to the authenticated user's own tenant", async () => {
    const req: any = {
      user: { id: "vendor-1", role: "IT_VENDOR", tenant: { tenantId: "tenant-A" } },
      query: {},
    };
    const res = mockRes();

    await getOpenings(req, res);

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: "tenant-A" } })
    );
    expect(countMock).toHaveBeenCalledWith({ where: { tenantId: "tenant-A" } });
  });

  it("never lets a client-controlled query parameter override the tenant scope", async () => {
    // Even if a caller tries to smuggle a different tenant via query params,
    // the controller only ever reads tenantId from req.user (server-derived).
    const req: any = {
      user: { id: "vendor-1", role: "IT_VENDOR", tenant: { tenantId: "tenant-A" } },
      query: { tenantId: "tenant-B", page: "1" },
    };
    const res = mockRes();

    await getOpenings(req, res);

    const whereArg = findManyMock.mock.calls[0][0].where;
    expect(whereArg.tenantId).toBe("tenant-A");
    expect(whereArg.tenantId).not.toBe("tenant-B");
  });
});
