from dataclasses import dataclass

from app.schemas import FeatureVector, ParsedResume, ScoringResult


@dataclass
class SessionState:
    """Artifacts the deterministic pipeline produces as the agent's tool
    calls progress through one recommendation run. Owned by ToolDispatcher;
    read by the orchestrator once a run finishes to build its metadata."""

    parsed_resume: ParsedResume | None = None
    feature_vector: FeatureVector | None = None
    scoring_result: ScoringResult | None = None
    used_vision_fallback: bool = False
