import json
from types import SimpleNamespace

import httpx
import pytest
from groq import BadRequestError

from app.agent.orchestrator import AgentOutputValidationError, run_recommendation_agent
from app.scoring.matching_engine import compute_final_score
from app.schemas import RecommendationContext, TokenUsage
from tests.helpers import make_pdf_b64


def fake_bad_request_error(message: str) -> BadRequestError:
    """A live probe against Groq showed some models occasionally wrap
    their final answer as a bogus tool call, which the API rejects with a
    400 before any message comes back — this reproduces that shape."""
    request = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
    response = httpx.Response(400, request=request, json={"error": {"message": message}})
    return BadRequestError(message, response=response, body={"error": {"message": message}})

RESUME_PARSING_SYSTEM_MARKER = "Resume Parsing Tool"


def usage() -> TokenUsage:
    return TokenUsage(promptTokens=10, completionTokens=5, totalTokens=15)


def tool_call_result(call_id: str, name: str, args: dict | None = None):
    tool_call = SimpleNamespace(
        id=call_id,
        function=SimpleNamespace(name=name, arguments=json.dumps(args or {})),
    )
    message = SimpleNamespace(role="assistant", content=None, tool_calls=[tool_call])
    return SimpleNamespace(message=message, token_usage=usage(), latency_ms=50)


def final_answer_result(payload: dict):
    message = SimpleNamespace(role="assistant", content=json.dumps(payload), tool_calls=None)
    return SimpleNamespace(message=message, token_usage=usage(), latency_ms=50)


def resume_parsed_result(payload: dict):
    message = SimpleNamespace(role="assistant", content=json.dumps(payload), tool_calls=None)
    return SimpleNamespace(message=message, token_usage=usage(), latency_ms=80)


CONTEXT = RecommendationContext(
    openingTitle="Senior Backend Engineer",
    requiredSkills=["react", "node.js"],
    experienceMin=3,
    experienceMax=8,
    openingLocation="Remote",
    contractType="C2C",
)

PARSED_RESUME_PAYLOAD = {
    "experienceYears": 6,
    "skills": ["React", "Node.js"],
    "normalizedSkills": ["react", "node.js"],
    "location": "Remote",
    "education": ["B.S. Computer Science"],
    "keywords": ["backend"],
}


@pytest.mark.asyncio
async def test_full_tool_calling_loop_overrides_llm_score(monkeypatch):
    """Runs resume_parsing -> feature_extraction -> matching_scoring -> final
    answer, and asserts the persisted score always matches the deterministic
    engine (never the LLM's own arithmetic)."""
    step = {"orchestrator": 0}

    async def fake_call_llm(messages, tools=None, tool_choice="auto", response_format=None, temperature=0.2, model=None):
        system_content = messages[0]["content"] if messages else ""
        if RESUME_PARSING_SYSTEM_MARKER in system_content:
            return resume_parsed_result(PARSED_RESUME_PAYLOAD)

        step["orchestrator"] += 1
        n = step["orchestrator"]
        if n == 1:
            return tool_call_result("call_1", "resume_parsing_tool")
        if n == 2:
            return tool_call_result("call_2", "feature_extraction_tool")
        if n == 3:
            return tool_call_result("call_3", "matching_scoring_engine_tool")
        # The LLM tries to claim its own (wrong) score — must be overridden.
        return final_answer_result(
            {"recommended": True, "score": 0.1234, "confidence": 0.87, "reason": "Strong skill and experience match."}
        )

    monkeypatch.setattr("app.agent.orchestrator.call_llm", fake_call_llm)
    monkeypatch.setattr("app.agent.tools.llm_json_retry.call_llm", fake_call_llm)

    pdf_b64 = make_pdf_b64("6 years experience with React and Node.js, based in Remote.")
    output, metadata = await run_recommendation_agent(pdf_b64, "pdf", CONTEXT)

    expected_final_score = compute_final_score(1, 1, 1)  # full skill/exp/location match

    assert output.score == expected_final_score
    assert output.score != 0.1234
    assert output.recommended is True
    assert output.confidence == 0.87
    assert metadata.scoring.finalScore == expected_final_score
    assert len(metadata.trace) > 0
    assert metadata.totalTokenUsage.totalTokens > 0


@pytest.mark.asyncio
async def test_retries_on_malformed_final_answer_then_succeeds(monkeypatch):
    step = {"orchestrator": 0}

    async def fake_call_llm(messages, tools=None, tool_choice="auto", response_format=None, temperature=0.2, model=None):
        system_content = messages[0]["content"] if messages else ""
        if RESUME_PARSING_SYSTEM_MARKER in system_content:
            return resume_parsed_result(
                {
                    "experienceYears": 6,
                    "skills": ["React"],
                    "normalizedSkills": ["react"],
                    "location": "Remote",
                    "education": [],
                    "keywords": [],
                }
            )

        step["orchestrator"] += 1
        n = step["orchestrator"]
        if n == 1:
            return tool_call_result("call_1", "resume_parsing_tool")
        if n == 2:
            return tool_call_result("call_2", "feature_extraction_tool")
        if n == 3:
            return tool_call_result("call_3", "matching_scoring_engine_tool")
        if n == 4:
            # Malformed: missing "reason" -> must fail schema validation and retry.
            return final_answer_result({"recommended": True, "score": 0.9, "confidence": 0.8})
        return final_answer_result(
            {"recommended": True, "score": 0.9, "confidence": 0.8, "reason": "Corrected response with all required fields."}
        )

    monkeypatch.setattr("app.agent.orchestrator.call_llm", fake_call_llm)
    monkeypatch.setattr("app.agent.tools.llm_json_retry.call_llm", fake_call_llm)

    pdf_b64 = make_pdf_b64("6 years of React experience, based in Remote, seeking new opportunities.")
    output, metadata = await run_recommendation_agent(pdf_b64, "pdf", CONTEXT)

    assert output.reason == "Corrected response with all required fields."
    assert metadata.retries >= 1


@pytest.mark.asyncio
async def test_refuses_to_answer_before_deterministic_pipeline_has_run(monkeypatch):
    async def fake_call_llm(messages, tools=None, tool_choice="auto", response_format=None, temperature=0.2, model=None):
        # Model tries to answer immediately without calling any tools.
        return final_answer_result({"recommended": True, "score": 0.99, "confidence": 0.99, "reason": "Looks great."})

    monkeypatch.setattr("app.agent.orchestrator.call_llm", fake_call_llm)

    pdf_b64 = make_pdf_b64("irrelevant — the model never calls resume_parsing_tool in this test")
    with pytest.raises(AgentOutputValidationError):
        await run_recommendation_agent(pdf_b64, "pdf", CONTEXT)


@pytest.mark.asyncio
async def test_recovers_when_model_wraps_final_answer_as_a_bogus_tool_call(monkeypatch):
    """Live-observed on Groq's gpt-oss-120b: the model sometimes calls a
    fictitious 'json' tool (not in AGENT_TOOLS) instead of returning its
    final answer as plain content, which the API rejects with a 400
    before any message comes back. The orchestrator must treat that as a
    retryable condition, not crash."""
    step = {"orchestrator": 0}

    async def fake_call_llm(messages, tools=None, tool_choice="auto", response_format=None, temperature=0.2, model=None):
        system_content = messages[0]["content"] if messages else ""
        if RESUME_PARSING_SYSTEM_MARKER in system_content:
            return resume_parsed_result(PARSED_RESUME_PAYLOAD)

        step["orchestrator"] += 1
        n = step["orchestrator"]
        if n == 1:
            return tool_call_result("call_1", "resume_parsing_tool")
        if n == 2:
            return tool_call_result("call_2", "feature_extraction_tool")
        if n == 3:
            return tool_call_result("call_3", "matching_scoring_engine_tool")
        if n == 4:
            raise fake_bad_request_error(
                "Tool call validation failed: attempted to call tool 'json' which was not in request.tools"
            )
        return final_answer_result(
            {"recommended": True, "score": 1.0, "confidence": 0.95, "reason": "Recovered after the bogus tool call."}
        )

    monkeypatch.setattr("app.agent.orchestrator.call_llm", fake_call_llm)
    monkeypatch.setattr("app.agent.tools.llm_json_retry.call_llm", fake_call_llm)

    pdf_b64 = make_pdf_b64("6 years experience with React and Node.js, based in Remote.")
    output, metadata = await run_recommendation_agent(pdf_b64, "pdf", CONTEXT)

    assert output.reason == "Recovered after the bogus tool call."
    assert metadata.retries >= 1
