/**
 * Type definitions shared by the AI Recommendation Agent pipeline.
 *
 * These are the structured contracts passed between the LLM tool-calling
 * orchestrator and the deterministic tools it invokes. Every value that
 * crosses this boundary is validated against the JSON Schemas in
 * `services/agent/schemas.ts` before being trusted.
 */

/** Structured schema returned by the Resume Parsing Tool. */
export interface ParsedResume {
  experienceYears: number;
  skills: string[];
  normalizedSkills: string[];
  location: string;
  education: string[];
  keywords: string[];
}

/** Feature vector produced by the Feature Extraction Tool. */
export interface FeatureVector {
  experienceYears: number;
  skills: string[];
  location: string;
  skillMatchScore: number;
  experienceMatchScore: number;
  locationMatchScore: number;
}

/** Output of the deterministic Matching & Scoring Engine tool. */
export interface ScoringResult {
  skillMatchScore: number;
  experienceMatchScore: number;
  locationMatchScore: number;
  finalScore: number;
}

export type RecommendationDecision =
  | "RECOMMENDED"
  | "BORDERLINE"
  | "NOT_RECOMMENDED";

/** Final structured output the agent must produce for persistence. */
export interface AgentOutput {
  recommended: boolean;
  score: number;
  confidence: number;
  reason: string;
}

/** Sanitized, non-DB-shaped context handed to the LLM agent. */
export interface RecommendationContext {
  openingTitle: string;
  requiredSkills: string[];
  experienceMin: number;
  experienceMax: number | null;
  openingLocation: string | null;
  contractType: string | null;
}

/** One entry in the agent's internal reasoning / tool-call trace. */
export interface AgentTraceEntry {
  step: number;
  type: "llm_call" | "tool_call" | "retry" | "decision";
  name: string;
  input?: unknown;
  output?: unknown;
  durationMs: number;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/** Full metadata persisted alongside a recommendation for explainability/audit. */
export interface RecommendationMetadata {
  trace: AgentTraceEntry[];
  totalTokenUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  retries: number;
  parsedResume?: ParsedResume;
  featureVector?: FeatureVector;
  scoring?: ScoringResult;
  timings: {
    startedAt: string;
    parsingMs?: number;
    matchingMs?: number;
    totalMs: number;
  };
  agentVersion: string;
  model: string;
  /** True when resume text was too thin and the vision-model fallback was used instead. */
  usedVisionFallback: boolean;
}
