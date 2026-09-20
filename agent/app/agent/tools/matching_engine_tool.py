from app.scoring.matching_engine import compute_final_score
from app.schemas import FeatureVector, ScoringResult


def run_matching_engine_tool(feature_vector: FeatureVector) -> ScoringResult:
    """Matching & Scoring Engine Tool.

    Applies the MANDATORY final score formula to the feature vector's
    per-dimension match scores:

      FinalScore = 0.5*skillMatchScore + 0.3*experienceMatchScore + 0.2*locationMatchScore

    This is the single source of truth for the final numeric score. The LLM
    never computes this value itself — it only consumes this tool's output
    to phrase an explanation and estimate a confidence level.
    """
    final_score = compute_final_score(
        feature_vector.skillMatchScore,
        feature_vector.experienceMatchScore,
        feature_vector.locationMatchScore,
    )

    return ScoringResult(
        skillMatchScore=feature_vector.skillMatchScore,
        experienceMatchScore=feature_vector.experienceMatchScore,
        locationMatchScore=feature_vector.locationMatchScore,
        finalScore=final_score,
    )
