from app.scoring.matching_engine import (
    score_experience_match,
    score_location_match,
    score_skill_match,
)
from app.scoring.skill_normalization import normalize_skills
from app.schemas import FeatureVector, ParsedResume, RecommendationContext


def run_feature_extraction_tool(
    parsed_resume: ParsedResume, context: RecommendationContext
) -> FeatureVector:
    """Feature Extraction Tool.

    Deterministic by design: it combines the parsed resume with the
    opening's requirements to produce the feature vector (including the
    per-dimension match scores), using the same pure scoring primitives the
    unit tests exercise directly. No LLM call happens here — this is the
    "Deterministic Matching Engine" half of the pipeline, invoked as a tool
    from the agent's reasoning loop rather than hardcoded in a controller.
    """
    candidate_skills = normalize_skills(
        parsed_resume.normalizedSkills if parsed_resume.normalizedSkills else parsed_resume.skills
    )
    required_skills = normalize_skills(context.requiredSkills)

    return FeatureVector(
        experienceYears=parsed_resume.experienceYears,
        skills=candidate_skills,
        location=parsed_resume.location,
        skillMatchScore=score_skill_match(candidate_skills, required_skills),
        experienceMatchScore=score_experience_match(
            parsed_resume.experienceYears, context.experienceMin, context.experienceMax
        ),
        locationMatchScore=score_location_match(parsed_resume.location, context.openingLocation),
    )
