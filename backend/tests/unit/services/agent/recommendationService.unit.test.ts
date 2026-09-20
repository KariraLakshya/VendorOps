import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../src/config/prisma/prisma", () => ({ default: {} }));

import {
  isAlreadyProcessed,
  buildRecommendationContext,
} from "../../../../src/services/agent/recommendationService";

describe("isAlreadyProcessed (idempotency check)", () => {
  it.each(["COMPLETED", "PROCESSING"])("treats %s as already processed", (status) => {
    expect(isAlreadyProcessed({ recommendationStatus: status } as any)).toBe(true);
  });

  it.each(["PENDING", "FAILED"])("does not treat %s as already processed", (status) => {
    expect(isAlreadyProcessed({ recommendationStatus: status } as any)).toBe(false);
  });
});

describe("buildRecommendationContext", () => {
  it("maps only the fields the agent needs, never the raw opening row", () => {
    const opening = {
      id: "opening-1",
      tenantId: "tenant-1",
      hiringManagerId: "manager-1",
      title: "Backend Engineer",
      requiredSkills: ["node.js", "postgresql"],
      experienceMin: 3,
      experienceMax: 8,
      location: "Remote",
      contractType: "C2C",
      status: "OPEN",
    } as any;

    expect(buildRecommendationContext(opening)).toEqual({
      openingTitle: "Backend Engineer",
      requiredSkills: ["node.js", "postgresql"],
      experienceMin: 3,
      experienceMax: 8,
      openingLocation: "Remote",
      contractType: "C2C",
    });
  });
});
