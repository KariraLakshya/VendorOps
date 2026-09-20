"""
Deterministic skill normalization. Maps common synonyms/aliases to a
canonical skill name so matching isn't defeated by superficial naming
differences (e.g. "JS" vs "JavaScript").

Dictionary-based rather than LLM-based on purpose: normalization must be
reproducible so it can be invoked as a tool and unit tested like any other
deterministic component.
"""
import re

SKILL_ALIASES: dict[str, str] = {
    "js": "javascript",
    "javascript": "javascript",
    "ts": "typescript",
    "typescript": "typescript",
    "reactjs": "react",
    "react.js": "react",
    "react": "react",
    "nodejs": "node.js",
    "node.js": "node.js",
    "node": "node.js",
    "nextjs": "next.js",
    "next.js": "next.js",
    "postgres": "postgresql",
    "postgresql": "postgresql",
    "psql": "postgresql",
    "mongo": "mongodb",
    "mongodb": "mongodb",
    "py": "python",
    "python": "python",
    "golang": "go",
    "go": "go",
    "k8s": "kubernetes",
    "kubernetes": "kubernetes",
    "aws": "aws",
    "amazon web services": "aws",
    "gcp": "gcp",
    "google cloud": "gcp",
    "google cloud platform": "gcp",
    "azure": "azure",
    "docker": "docker",
    "ci_cd": "ci/cd",
    "ci/cd": "ci/cd",
    "cicd": "ci/cd",
    "ml": "machine learning",
    "machine learning": "machine learning",
    "ai": "artificial intelligence",
    "restapi": "rest api",
    "rest api": "rest api",
    "rest apis": "rest api",
    "graphql": "graphql",
}


def _normalize_token(raw: str) -> str:
    token = raw.strip().lower()
    token = re.sub(r"[_\s]+", " ", token)
    token = token.strip(".")
    return token


def normalize_skill(skill: str) -> str:
    """Normalizes a single skill string to its canonical form."""
    key = _normalize_token(skill)
    return SKILL_ALIASES.get(key, key)


def normalize_skills(skills: list[str]) -> list[str]:
    """Normalizes a list of skills, de-duplicating the canonical results."""
    normalized = [normalize_skill(s) for s in skills if isinstance(s, str) and s.strip()]
    # dict.fromkeys preserves order while de-duplicating (unlike set()).
    return list(dict.fromkeys(normalized))
