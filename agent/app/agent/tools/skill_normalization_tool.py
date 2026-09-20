from app.scoring.skill_normalization import normalize_skills


def run_skill_normalization_tool(skills: list[str]) -> dict:
    """Skill Normalization Tool — pure, deterministic, no LLM/network calls."""
    return {"normalizedSkills": normalize_skills(skills)}
