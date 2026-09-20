"""
Tool Registry — the JSON-Schema function declarations exposed to the LLM
for dynamic tool-calling. The LLM sees only these names/descriptions/
parameter shapes; it never sees raw DB models or file bytes directly.

Tools are intentionally near-stateless from the LLM's point of view: most
take no (or minimal, optional) arguments because their real inputs (the
parsed resume, the opening's requirements) are tracked server-side in the
orchestrator's session state as the pipeline progresses. This avoids
forcing the model to losslessly round-trip large structured blobs through
free-form JSON arguments, while still leaving the decision of *whether and
when* to call each tool entirely up to the model.
"""

RESUME_PARSING = "resume_parsing_tool"
SKILL_NORMALIZATION = "skill_normalization_tool"
FEATURE_EXTRACTION = "feature_extraction_tool"
MATCHING_SCORING_ENGINE = "matching_scoring_engine_tool"

AGENT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": RESUME_PARSING,
            "description": (
                "Parses the candidate's resume (already loaded for this run) into a "
                "structured schema: experienceYears, skills, normalizedSkills, location, "
                "education, keywords. Call this first, before any other tool."
            ),
            "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        },
    },
    {
        "type": "function",
        "function": {
            "name": SKILL_NORMALIZATION,
            "description": (
                "Normalizes a list of raw skill strings into canonical, de-duplicated skill "
                "names (e.g. 'JS' -> 'javascript'). If no skills are provided, normalizes the "
                "skills already extracted by the resume parsing tool."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "skills": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Optional explicit list of raw skill strings to normalize.",
                    }
                },
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": FEATURE_EXTRACTION,
            "description": (
                "Builds the candidate's feature vector (experience, skills, location, and "
                "per-dimension match scores against the opening's requirements) from the "
                "already-parsed resume. Requires resume_parsing_tool to have run first."
            ),
            "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        },
    },
    {
        "type": "function",
        "function": {
            "name": MATCHING_SCORING_ENGINE,
            "description": (
                "Deterministically computes the final weighted match score "
                "(0.5*skill + 0.3*experience + 0.2*location) and the decision bucket from the "
                "feature vector. Requires feature_extraction_tool to have run first. This is the "
                "ONLY source of truth for the numeric score — never invent or compute a score yourself."
            ),
            "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        },
    },
]
