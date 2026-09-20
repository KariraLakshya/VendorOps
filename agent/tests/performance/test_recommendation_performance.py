import asyncio
import json
import time
from types import SimpleNamespace

import pytest

from app.agent.orchestrator import run_recommendation_agent
from app.schemas import RecommendationContext, TokenUsage
from tests.helpers import make_pdf_b64

RESUME_PARSING_SYSTEM_MARKER = "Resume Parsing Tool"
SIMULATED_NETWORK_LATENCY_S = 0.004  # stand-in for a real Groq call's network latency

CONTEXT = RecommendationContext(
    openingTitle="Full Stack Developer",
    requiredSkills=["react", "node.js", "aws"],
    experienceMin=2,
    experienceMax=6,
    openingLocation="Remote",
    contractType="W2",
)


def usage() -> TokenUsage:
    return TokenUsage(promptTokens=10, completionTokens=5, totalTokens=15)


def percentile(sorted_values: list[float], p: float) -> float:
    index = max(0, int(round((p / 100) * len(sorted_values))) - 1)
    return sorted_values[min(index, len(sorted_values) - 1)]


@pytest.mark.asyncio
async def test_p95_latency_under_sla(monkeypatch):
    step = {"n": 0}

    async def fake_call_llm(messages, tools=None, tool_choice="auto", response_format=None, temperature=0.2, model=None):
        await asyncio.sleep(SIMULATED_NETWORK_LATENCY_S)
        system_content = messages[0]["content"] if messages else ""

        if RESUME_PARSING_SYSTEM_MARKER in system_content:
            message = SimpleNamespace(
                role="assistant",
                content=json.dumps(
                    {
                        "experienceYears": 4,
                        "skills": ["React", "Node.js", "AWS"],
                        "normalizedSkills": ["react", "node.js", "aws"],
                        "location": "Remote",
                        "education": [],
                        "keywords": [],
                    }
                ),
                tool_calls=None,
            )
            return SimpleNamespace(message=message, token_usage=usage(), latency_ms=int(SIMULATED_NETWORK_LATENCY_S * 1000))

        step["n"] += 1
        local_step = step["n"] % 4

        def tool_call(name: str):
            tc = SimpleNamespace(id=f"c{step['n']}", function=SimpleNamespace(name=name, arguments="{}"))
            message = SimpleNamespace(role="assistant", content=None, tool_calls=[tc])
            return SimpleNamespace(message=message, token_usage=usage(), latency_ms=int(SIMULATED_NETWORK_LATENCY_S * 1000))

        if local_step == 1:
            return tool_call("resume_parsing_tool")
        if local_step == 2:
            return tool_call("feature_extraction_tool")
        if local_step == 3:
            return tool_call("matching_scoring_engine_tool")

        message = SimpleNamespace(
            role="assistant",
            content=json.dumps({"recommended": True, "score": 0.9, "confidence": 0.85, "reason": "Good overall match."}),
            tool_calls=None,
        )
        return SimpleNamespace(message=message, token_usage=usage(), latency_ms=int(SIMULATED_NETWORK_LATENCY_S * 1000))

    monkeypatch.setattr("app.agent.orchestrator.call_llm", fake_call_llm)
    monkeypatch.setattr("app.agent.tools.llm_json_retry.call_llm", fake_call_llm)

    profile_count = 100
    durations: list[float] = []
    pdf_b64 = make_pdf_b64("4 years experience with React, Node.js, AWS. Remote.")

    for _ in range(profile_count):
        start = time.perf_counter()
        await run_recommendation_agent(pdf_b64, "pdf", CONTEXT)
        durations.append((time.perf_counter() - start) * 1000)

    sorted_durations = sorted(durations)
    p95 = percentile(sorted_durations, 95)

    assert len(durations) == profile_count
    assert p95 < 2000
