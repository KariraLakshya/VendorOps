import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";

vi.mock("axios", () => ({
  default: {
    post: vi.fn(),
    isAxiosError: vi.fn(),
  },
}));

import { requestRecommendation } from "../../../../src/services/agent/agentServiceClient";

const mockedAxios = vi.mocked(axios, true);

const context = {
  openingTitle: "Backend Engineer",
  requiredSkills: ["node.js"],
  experienceMin: 2,
  experienceMax: 6,
  openingLocation: "Remote",
  contractType: "W2",
};

describe("agentServiceClient (Node -> Python FastAPI agent service)", () => {
  beforeEach(() => {
    mockedAxios.post.mockReset();
    mockedAxios.isAxiosError.mockReset();
  });

  it("posts the base64 resume file, format, and context to /recommend and returns the parsed response", async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        output: { recommended: true, score: 0.9, confidence: 0.8, reason: "Good fit" },
        metadata: { agentVersion: "1.0.0" },
      },
    });

    const result = await requestRecommendation("ZmFrZS1wZGYtYnl0ZXM=", "pdf", context as any);

    expect(mockedAxios.post).toHaveBeenCalledWith(
      expect.stringContaining("/recommend"),
      { resumeFile: "ZmFrZS1wZGYtYnl0ZXM=", fileFormat: "pdf", context },
      expect.objectContaining({
        timeout: expect.any(Number),
        headers: expect.objectContaining({ "X-Internal-Api-Key": expect.any(String) }),
      })
    );
    expect(result.output.recommended).toBe(true);
    expect(result.metadata.agentVersion).toBe("1.0.0");
  });

  it("surfaces the FastAPI service's error detail message on failure", async () => {
    mockedAxios.isAxiosError.mockReturnValue(true);
    mockedAxios.post.mockRejectedValue({
      response: { data: { detail: "GROQ_API_KEY is not configured." } },
      message: "Request failed with status code 500",
    });

    await expect(requestRecommendation("ZmFrZQ==", "pdf", context as any)).rejects.toThrow(
      "GROQ_API_KEY is not configured."
    );
  });
});
