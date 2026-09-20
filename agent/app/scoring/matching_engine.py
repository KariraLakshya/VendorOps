"""
Deterministic Matching & Scoring Engine.

No LLM calls, no I/O. Invoked as a tool by the agent orchestrator
(see `app/agent/tools/matching_engine_tool.py`) so the numeric result is
always reproducible and explainable, independent of any model's internal
reasoning.
"""
from app.schemas import RecommendationDecision, ScoringResult

SCORE_WEIGHTS = {"skill": 0.5, "experience": 0.3, "location": 0.2}

DECISION_THRESHOLDS = {"recommended": 0.75, "borderline": 0.5}


def score_experience_match(
    candidate_experience_years: float,
    experience_min: int,
    experience_max: int | None,
) -> float:
    """Experience Logic:
    - below the minimum required experience -> 0
    - within [min, max] (or >= min when no max is specified) -> 1
    - above the maximum -> 0.8 (overqualified, still a plausible match)
    """
    if candidate_experience_years < experience_min:
        return 0.0
    if experience_max is not None and candidate_experience_years > experience_max:
        return 0.8
    return 1.0


def score_skill_match(candidate_skills: list[str], required_skills: list[str]) -> float:
    """Skill Match: overlap / requiredSkills.

    Comparison is case-insensitive on trimmed skill names. When an opening
    declares no required skills, there is nothing to fail to match, so the
    score is defined as a full match.
    """
    if not required_skills:
        return 1.0

    normalized_candidate = {s.strip().lower() for s in candidate_skills}
    overlap = sum(1 for skill in required_skills if skill.strip().lower() in normalized_candidate)
    return overlap / len(required_skills)


def score_location_match(candidate_location: str | None, opening_location: str | None) -> float:
    """Location Match:
    - opening is remote -> 1
    - candidate location exactly matches the opening's location -> 1
    - otherwise (onsite mismatch) -> 0.5
    """
    normalized_opening_location = opening_location.strip().lower() if opening_location else None

    if not normalized_opening_location or normalized_opening_location == "remote":
        return 1.0

    normalized_candidate_location = candidate_location.strip().lower() if candidate_location else None
    if normalized_candidate_location and normalized_candidate_location == normalized_opening_location:
        return 1.0

    return 0.5


def compute_final_score(
    skill_match_score: float, experience_match_score: float, location_match_score: float
) -> float:
    """Final Score Formula (MANDATORY):
    FinalScore = 0.5*skillMatchScore + 0.3*experienceMatchScore + 0.2*locationMatchScore
    """
    score = (
        SCORE_WEIGHTS["skill"] * skill_match_score
        + SCORE_WEIGHTS["experience"] * experience_match_score
        + SCORE_WEIGHTS["location"] * location_match_score
    )
    # Guard against floating point drift (e.g. 0.7999999999999999).
    return round(score, 4)


def run_matching_engine(
    candidate_experience_years: float,
    candidate_skills: list[str],
    candidate_location: str | None,
    experience_min: int,
    experience_max: int | None,
    required_skills: list[str],
    opening_location: str | None,
) -> ScoringResult:
    """Runs the full deterministic pipeline and returns the score breakdown
    exactly as the spec's Matching & Scoring Engine contract requires."""
    skill_match_score = score_skill_match(candidate_skills, required_skills)
    experience_match_score = score_experience_match(candidate_experience_years, experience_min, experience_max)
    location_match_score = score_location_match(candidate_location, opening_location)
    final_score = compute_final_score(skill_match_score, experience_match_score, location_match_score)

    return ScoringResult(
        skillMatchScore=skill_match_score,
        experienceMatchScore=experience_match_score,
        locationMatchScore=location_match_score,
        finalScore=final_score,
    )


def decide_recommendation(final_score: float) -> RecommendationDecision:
    """Decision Policy: maps a final score to one of the three mandated buckets."""
    if final_score >= DECISION_THRESHOLDS["recommended"]:
        return "RECOMMENDED"
    if final_score >= DECISION_THRESHOLDS["borderline"]:
        return "BORDERLINE"
    return "NOT_RECOMMENDED"
