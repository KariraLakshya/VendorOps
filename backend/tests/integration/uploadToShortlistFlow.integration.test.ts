/**
 * Full flow: Upload -> Submit -> Recommend -> Shortlist.
 *
 * Exercises the REAL controllers/services for each stage
 * (uploadProfiles -> processRecommendation -> shortlistProfile/rejectProfile)
 * wired together through one shared in-memory Prisma stand-in, so a bug in
 * how one stage names/reads a field the previous stage wrote would show up
 * here even though each stage's own unit tests (which mock Prisma
 * per-call) wouldn't catch it.
 *
 * Only the true external edges are stubbed: the S3 byte transfer
 * (FileUploadService, storageFactory) and the HTTP call to the Python
 * agent service (which now owns all resume text extraction itself).
 * Everything about how a profile moves from SUBMITTED -> COMPLETED ->
 * SHORTLISTED runs for real.
 */
import { Readable } from "stream";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakePrisma, type FakePrismaClient } from "../helpers/fakePrisma";

const { prismaHolder, requestRecommendationMock, enqueueRecommendationMock } = vi.hoisted(() => ({
  prismaHolder: { current: null as FakePrismaClient | null },
  requestRecommendationMock: vi.fn(),
  enqueueRecommendationMock: vi.fn(),
}));

vi.mock("../../src/config/prisma/prisma", () => ({
  default: new Proxy(
    {},
    {
      get: (_target, prop) => (prismaHolder.current as any)[prop],
    }
  ),
}));

vi.mock("../../src/services/upload/fileUploadService", () => ({
  FileUploadService: class {
    async uploadFile(request: { fileBuffer: Buffer }) {
      return { key: "contract-uploads/tenant-1/opening-1/resume.pdf", filename: "resume.pdf", success: true };
    }
  },
}));

vi.mock("../../src/services/storage/storageFactory", () => ({
  createStorageService: () => ({
    getObjectStream: async () => Readable.from(Buffer.from("dummy pdf bytes")),
  }),
}));

vi.mock("../../src/services/agent/agentServiceClient", () => ({
  requestRecommendation: requestRecommendationMock,
}));

vi.mock("../../src/services/agent/recommendationQueue", () => ({
  enqueueRecommendation: enqueueRecommendationMock,
}));

import { uploadProfiles } from "../../src/controllers/vendor/profiles/uploadProfiles";
import { processRecommendation } from "../../src/services/agent/recommendationService";
import { shortlistProfile, rejectProfile } from "../../src/controllers/hiringManager/profiles/decideProfile";

const TENANT_ID = "tenant-1";
const OPENING_ID = "opening-1";
const VENDOR_ID = "vendor-1";
const HIRING_MANAGER_ID = "manager-1";

function seedOpening(overrides: Record<string, any> = {}) {
  return {
    id: OPENING_ID,
    tenantId: TENANT_ID,
    hiringManagerId: HIRING_MANAGER_ID,
    title: "Full Stack Developer",
    requiredSkills: ["react", "node.js"],
    experienceMin: 2,
    experienceMax: 6,
    location: "Remote",
    contractType: "W2",
    ...overrides,
  };
}

function mockRes() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

function vendorReq(overrides: Record<string, any> = {}) {
  return {
    user: { id: VENDOR_ID, tenant: { tenantId: TENANT_ID } },
    params: { id: OPENING_ID },
    files: [{ originalname: "resume.pdf", buffer: Buffer.from("fake-pdf-bytes"), mimetype: "application/pdf" }],
    body: { uploadTokens: JSON.stringify([{ filename: "resume.pdf", uploadToken: "opaque-token" }]) },
    ...overrides,
  };
}

function hiringManagerReq(profileId: number) {
  return {
    user: { id: HIRING_MANAGER_ID, tenant: { tenantId: TENANT_ID } },
    params: { profileId: String(profileId) },
  };
}

async function runUploadStage(): Promise<number> {
  const res = mockRes();
  await uploadProfiles(vendorReq() as any, res);

  expect(res.status).toHaveBeenCalledWith(201);
  const [profileId] = res.json.mock.calls[0][0].data.profileIds;
  return profileId;
}

describe("Full flow: Upload -> Submit -> Recommend -> Shortlist", () => {
  beforeEach(() => {
    prismaHolder.current = createFakePrisma({ openings: [seedOpening()] });
    requestRecommendationMock.mockReset();
    enqueueRecommendationMock.mockReset();
  });

  it("takes a profile from upload through a completed recommendation to shortlisted", async () => {
    // --- Upload / Submit ---
    const profileId = await runUploadStage();
    expect(enqueueRecommendationMock).toHaveBeenCalledWith(profileId);

    let profile = await prismaHolder.current!.hiringProfile.findUnique({ where: { id: profileId } });
    expect(profile.status).toBe("SUBMITTED");
    expect(profile.recommendationStatus).toBe("PENDING");
    expect(profile.tenantId).toBe(TENANT_ID);

    // --- Recommend ---
    requestRecommendationMock.mockResolvedValue({
      output: { recommended: true, score: 0.82, confidence: 0.9, reason: "Strong skill and experience match." },
      metadata: {
        agentVersion: "1.0.0",
        model: "mock-model",
        trace: [],
        totalTokenUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        retries: 0,
        timings: { startedAt: new Date().toISOString(), totalMs: 42 },
        usedVisionFallback: false,
      },
    });

    await processRecommendation(profileId);

    expect(requestRecommendationMock).toHaveBeenCalledTimes(1);
    const [resumeFileB64Arg, fileFormatArg, contextArg] = requestRecommendationMock.mock.calls[0];
    expect(resumeFileB64Arg).toBe(Buffer.from("dummy pdf bytes").toString("base64"));
    expect(fileFormatArg).toBe("pdf");
    expect(contextArg).toEqual({
      openingTitle: "Full Stack Developer",
      requiredSkills: ["react", "node.js"],
      experienceMin: 2,
      experienceMax: 6,
      openingLocation: "Remote",
      contractType: "W2",
    });

    profile = await prismaHolder.current!.hiringProfile.findUnique({ where: { id: profileId } });
    expect(profile.recommendationStatus).toBe("COMPLETED");
    expect(profile.recommended).toBe(true);
    expect(profile.recommendationScore).toBe(0.82);
    expect(profile.recommendationReason).toBe("Strong skill and experience match.");

    // --- Shortlist ---
    const shortlistRes = mockRes();
    await shortlistProfile(hiringManagerReq(profileId) as any, shortlistRes);

    expect(shortlistRes.status).toHaveBeenCalledWith(200);
    profile = await prismaHolder.current!.hiringProfile.findUnique({ where: { id: profileId } });
    expect(profile.status).toBe("SHORTLISTED");
    expect(profile.shortlistedBy).toBe(HIRING_MANAGER_ID);
  });

  it("supports reject as the alternative decision after a completed recommendation", async () => {
    const profileId = await runUploadStage();

    requestRecommendationMock.mockResolvedValue({
      output: { recommended: false, score: 0.3, confidence: 0.7, reason: "Skill gap on required stack." },
      metadata: {
        agentVersion: "1.0.0",
        model: "mock-model",
        trace: [],
        totalTokenUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        retries: 0,
        timings: { startedAt: new Date().toISOString(), totalMs: 30 },
        usedVisionFallback: false,
      },
    });
    await processRecommendation(profileId);

    const rejectRes = mockRes();
    await rejectProfile(hiringManagerReq(profileId) as any, rejectRes);

    expect(rejectRes.status).toHaveBeenCalledWith(200);
    const profile = await prismaHolder.current!.hiringProfile.findUnique({ where: { id: profileId } });
    expect(profile.status).toBe("REJECTED");
    expect(profile.rejectedBy).toBe(HIRING_MANAGER_ID);
  });

  it("self-heals on the next trigger after a transient agent-service failure (idempotent re-run support)", async () => {
    const profileId = await runUploadStage();

    requestRecommendationMock.mockRejectedValueOnce(new Error("agent service unreachable"));
    await processRecommendation(profileId);

    let profile = await prismaHolder.current!.hiringProfile.findUnique({ where: { id: profileId } });
    expect(profile.recommendationStatus).toBe("FAILED");
    expect(profile.recommendationError).toBe("agent service unreachable");

    // FAILED is a claimable state, so a later trigger (e.g. a retry queue,
    // or the same enqueue firing again) reprocesses it without needing
    // `force: true` — no manual intervention required for a transient error.
    requestRecommendationMock.mockResolvedValue({
      output: { recommended: true, score: 0.8, confidence: 0.85, reason: "Good match on retry." },
      metadata: {
        agentVersion: "1.0.0",
        model: "mock-model",
        trace: [],
        totalTokenUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        retries: 0,
        timings: { startedAt: new Date().toISOString(), totalMs: 25 },
        usedVisionFallback: false,
      },
    });
    await processRecommendation(profileId);

    profile = await prismaHolder.current!.hiringProfile.findUnique({ where: { id: profileId } });
    expect(profile.recommendationStatus).toBe("COMPLETED");
    expect(profile.recommendationScore).toBe(0.8);
  });

  it("rejects a hiring manager who does not own the opening, even after a completed recommendation", async () => {
    const profileId = await runUploadStage();

    requestRecommendationMock.mockResolvedValue({
      output: { recommended: true, score: 0.9, confidence: 0.9, reason: "Great fit." },
      metadata: {
        agentVersion: "1.0.0",
        model: "mock-model",
        trace: [],
        totalTokenUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        retries: 0,
        timings: { startedAt: new Date().toISOString(), totalMs: 20 },
        usedVisionFallback: false,
      },
    });
    await processRecommendation(profileId);

    const req = hiringManagerReq(profileId);
    req.user.id = "some-other-manager";
    const res = mockRes();

    await shortlistProfile(req as any, res);

    expect(res.status).toHaveBeenCalledWith(403);
    const profile = await prismaHolder.current!.hiringProfile.findUnique({ where: { id: profileId } });
    expect(profile.status).toBe("SUBMITTED");
  });
});
