import { describe, it, expect, vi, beforeEach } from "vitest";

const { findFirstMock, updateMock } = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  updateMock: vi.fn(),
}));

vi.mock("../../../../src/config/prisma/prisma", () => ({
  default: {
    hiringProfile: { findFirst: findFirstMock, update: updateMock },
    // The controller runs the ownership check + write inside one
    // transaction; simulate that by just invoking the callback with the
    // same mocked client standing in for `tx`.
    $transaction: (fn: (tx: unknown) => unknown) => fn({ hiringProfile: { findFirst: findFirstMock, update: updateMock } }),
  },
}));

import { shortlistProfile } from "../../../../src/controllers/hiringManager/profiles/decideProfile";

function mockRes() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe("shortlistProfile — ownership enforcement (opening.hiringManagerId === loggedInUser.id)", () => {
  beforeEach(() => {
    findFirstMock.mockReset();
    updateMock.mockReset();
  });

  it("rejects with 403 when the profile's opening belongs to a different hiring manager", async () => {
    findFirstMock.mockResolvedValue({
      id: 1,
      tenantId: "tenant-A",
      opening: { hiringManagerId: "other-manager" },
    });
    const req: any = {
      user: { id: "manager-1", tenant: { tenantId: "tenant-A" } },
      params: { profileId: "1" },
    };
    const res = mockRes();

    await shortlistProfile(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns 404 rather than leaking existence of a profile in another tenant", async () => {
    // findFirst is itself tenant-scoped, so a cross-tenant profile id simply
    // never resolves.
    findFirstMock.mockResolvedValue(null);
    const req: any = {
      user: { id: "manager-1", tenant: { tenantId: "tenant-A" } },
      params: { profileId: "999" },
    };
    const res = mockRes();

    await shortlistProfile(req, res);

    expect(findFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "tenant-A" }),
      })
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("allows the owning hiring manager to shortlist", async () => {
    findFirstMock.mockResolvedValue({
      id: 1,
      tenantId: "tenant-A",
      opening: { hiringManagerId: "manager-1" },
    });
    updateMock.mockResolvedValue({ id: 1, status: "SHORTLISTED" });
    const req: any = {
      user: { id: "manager-1", tenant: { tenantId: "tenant-A" } },
      params: { profileId: "1" },
    };
    const res = mockRes();

    await shortlistProfile(req, res);

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: expect.objectContaining({ status: "SHORTLISTED", shortlistedBy: "manager-1" }),
      })
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
