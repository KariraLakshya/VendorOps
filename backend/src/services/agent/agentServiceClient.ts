import axios from "axios";
import type { RecommendationContext, AgentOutput, RecommendationMetadata } from "../../types/agent.js";
import type { SupportedResumeFormat } from "../../utils/resume/detectResumeFormat.js";

/**
 * Thin HTTP client for the Python/FastAPI AI Recommendation Agent
 * (the `agent` service). This Node backend owns auth/RBAC, S3 storage,
 * and persistence; the agent's LLM tool-calling loop, resume text
 * extraction, and deterministic scoring engine live entirely in that
 * separate Python service — this client is the only integration point
 * between the two.
 */
const AGENT_SERVICE_URL = process.env.AGENT_SERVICE_URL || "http://localhost:8001";
const AGENT_SERVICE_TIMEOUT_MS = Number(process.env.AGENT_SERVICE_TIMEOUT_MS ?? 20000);
// Must match the agent service's AGENT_SERVICE_API_KEY exactly — it fails
// closed (rejects every request) if either side leaves this unset.
const AGENT_SERVICE_API_KEY = process.env.AGENT_SERVICE_API_KEY || "";

export interface AgentServiceResponse {
  output: AgentOutput;
  metadata: RecommendationMetadata;
}

export async function requestRecommendation(
  resumeFileB64: string,
  fileFormat: SupportedResumeFormat,
  context: RecommendationContext
): Promise<AgentServiceResponse> {
  try {
    const response = await axios.post<AgentServiceResponse>(
      `${AGENT_SERVICE_URL}/recommend`,
      { resumeFile: resumeFileB64, fileFormat, context },
      {
        timeout: AGENT_SERVICE_TIMEOUT_MS,
        headers: { "X-Internal-Api-Key": AGENT_SERVICE_API_KEY },
      }
    );
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const detail = (error.response?.data as { detail?: string } | undefined)?.detail;
      throw new Error(
        detail || error.message || "AI Recommendation Agent service request failed"
      );
    }
    throw error;
  }
}
