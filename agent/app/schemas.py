"""
Pydantic models shared across the agent pipeline.

Every structured value that crosses the LLM boundary (parsed resume,
feature vector, scoring result, final answer) is one of these models.
Pydantic's validation IS the Schema Validator layer required by the spec:
a `ValidationError` here is what drives the orchestrator's retry loop.
"""
from typing import Literal

from pydantic import BaseModel, Field, ConfigDict


class RecommendationContext(BaseModel):
    """Sanitized opening requirements handed to the agent. Deliberately NOT
    a raw DB row — only the fields the agent actually needs."""

    model_config = ConfigDict(extra="forbid")

    openingTitle: str
    requiredSkills: list[str]
    experienceMin: int
    experienceMax: int | None = None
    openingLocation: str | None = None
    contractType: str | None = None


class RecommendationRequest(BaseModel):
    """The Node backend sends the raw file, not pre-extracted text — text
    extraction (PyMuPDF/python-pptx) and the vision fallback both live in
    this service now, sharing one text-quality heuristic instead of Node
    and Python each guessing independently at what counts as "enough
    text". Node's only job is retrieving the bytes from S3."""

    model_config = ConfigDict(extra="forbid")

    resumeFile: str = Field(..., min_length=1, description="Base64-encoded original resume file bytes.")
    fileFormat: Literal["pdf", "pptx"]
    context: RecommendationContext


class ParsedResume(BaseModel):
    """Structured schema returned by the Resume Parsing Tool."""

    model_config = ConfigDict(extra="forbid")

    experienceYears: float = Field(ge=0, le=60)
    skills: list[str]
    normalizedSkills: list[str]
    location: str
    education: list[str]
    keywords: list[str]


class FeatureVector(BaseModel):
    """Feature vector produced by the Feature Extraction Tool."""

    model_config = ConfigDict(extra="forbid")

    experienceYears: float = Field(ge=0)
    skills: list[str]
    location: str
    skillMatchScore: float = Field(ge=0, le=1)
    experienceMatchScore: float = Field(ge=0, le=1)
    locationMatchScore: float = Field(ge=0, le=1)


class ScoringResult(BaseModel):
    """Output of the deterministic Matching & Scoring Engine tool."""

    model_config = ConfigDict(extra="forbid")

    skillMatchScore: float = Field(ge=0, le=1)
    experienceMatchScore: float = Field(ge=0, le=1)
    locationMatchScore: float = Field(ge=0, le=1)
    finalScore: float = Field(ge=0, le=1)


RecommendationDecision = Literal["RECOMMENDED", "BORDERLINE", "NOT_RECOMMENDED"]


class AgentOutput(BaseModel):
    """Final structured output the agent must produce for persistence."""

    model_config = ConfigDict(extra="forbid")

    recommended: bool
    score: float = Field(ge=0, le=1)
    confidence: float = Field(ge=0, le=1)
    reason: str = Field(min_length=1, max_length=2000)


class TokenUsage(BaseModel):
    promptTokens: int = 0
    completionTokens: int = 0
    totalTokens: int = 0


class AgentTraceEntry(BaseModel):
    step: int
    type: Literal["llm_call", "tool_call", "retry", "decision"]
    name: str
    input: dict | None = None
    output: dict | None = None
    durationMs: int
    tokenUsage: TokenUsage | None = None


class Timings(BaseModel):
    startedAt: str
    parsingMs: int | None = None
    matchingMs: int | None = None
    totalMs: int


class RecommendationMetadata(BaseModel):
    trace: list[AgentTraceEntry]
    totalTokenUsage: TokenUsage
    retries: int
    parsedResume: ParsedResume | None = None
    featureVector: FeatureVector | None = None
    scoring: ScoringResult | None = None
    timings: Timings
    agentVersion: str
    model: str
    usedVisionFallback: bool = False


class RecommendationResponse(BaseModel):
    output: AgentOutput
    metadata: RecommendationMetadata


class ErrorResponse(BaseModel):
    error: str
