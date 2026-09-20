import base64
import io
import json
from types import SimpleNamespace

import pytest
from pptx import Presentation

from app.agent.tools.resume_parsing_tool import UnprocessableResumeError, run_resume_parsing_tool
from app.schemas import TokenUsage
from tests.helpers import make_pdf_b64


def usage() -> TokenUsage:
    return TokenUsage(promptTokens=20, completionTokens=10, totalTokens=30)


VALID_PARSED_RESUME = {
    "experienceYears": 7,
    "skills": ["Python", "FastAPI"],
    "normalizedSkills": ["python", "fastapi"],
    "location": "Metropolis",
    "education": ["B.S. Computer Science"],
    "keywords": ["backend"],
}


@pytest.mark.asyncio
async def test_uses_text_path_when_text_is_sufficient(monkeypatch):
    calls = []

    async def fake_call_llm(messages, tools=None, tool_choice="auto", response_format=None, temperature=0.2, model=None):
        calls.append({"model": model, "messages": messages})
        message = SimpleNamespace(content=json.dumps(VALID_PARSED_RESUME), tool_calls=None)
        return SimpleNamespace(message=message, token_usage=usage(), latency_ms=50)

    monkeypatch.setattr("app.agent.tools.llm_json_retry.call_llm", fake_call_llm)

    sufficient_text = "Experienced backend engineer with 7 years in Python and FastAPI, based in Metropolis. " * 3
    pdf_b64 = make_pdf_b64(sufficient_text)

    outcome = await run_resume_parsing_tool(pdf_b64, "pdf")

    assert outcome.used_vision is False
    assert outcome.result.location == "Metropolis"
    assert len(calls) == 1
    assert calls[0]["model"] is None  # falls back to the default text model


@pytest.mark.asyncio
async def test_thin_text_with_no_vision_model_configured_fails_clearly(monkeypatch):
    """As of writing, Groq has no vision-capable chat model available, so
    GROQ_VISION_MODEL is unset by default — this must fail with a clear,
    specific error rather than attempting (and 400ing on) a vision call."""
    monkeypatch.setattr("app.config.settings.groq_vision_model", "")

    async def fail_if_called(*args, **kwargs):
        raise AssertionError("should not call the LLM when no vision model is configured")

    monkeypatch.setattr("app.agent.tools.llm_json_retry.call_llm", fail_if_called)

    blank_pdf_b64 = make_pdf_b64("")  # a real PDF page with no text on it

    with pytest.raises(UnprocessableResumeError, match="no vision-capable model is configured"):
        await run_resume_parsing_tool(blank_pdf_b64, "pdf")


@pytest.mark.asyncio
async def test_falls_back_to_vision_when_configured_and_text_is_too_thin(monkeypatch):
    monkeypatch.setattr("app.config.settings.groq_vision_model", "some-vision-model")

    calls = []

    async def fake_call_llm(messages, tools=None, tool_choice="auto", response_format=None, temperature=0.2, model=None):
        calls.append({"model": model, "messages": messages})
        message = SimpleNamespace(content=json.dumps(VALID_PARSED_RESUME), tool_calls=None)
        return SimpleNamespace(message=message, token_usage=usage(), latency_ms=200)

    monkeypatch.setattr("app.agent.tools.llm_json_retry.call_llm", fake_call_llm)

    blank_pdf_b64 = make_pdf_b64("")  # a real PDF page with no text -> nothing for PyMuPDF to extract

    outcome = await run_resume_parsing_tool(blank_pdf_b64, "pdf")

    assert outcome.used_vision is True
    assert outcome.result.location == "Metropolis"
    assert len(calls) == 1

    vision_call = calls[0]
    assert vision_call["model"] == "some-vision-model"

    user_message = vision_call["messages"][1]
    assert isinstance(user_message["content"], list)
    image_parts = [part for part in user_message["content"] if part["type"] == "image_url"]
    assert len(image_parts) >= 1
    assert image_parts[0]["image_url"]["url"].startswith("data:image/png;base64,")


@pytest.mark.asyncio
async def test_raises_when_no_text_and_no_usable_images(monkeypatch):
    monkeypatch.setattr("app.config.settings.groq_vision_model", "some-vision-model")

    async def fail_if_called(*args, **kwargs):
        raise AssertionError("should not call the LLM when there is nothing to show it")

    monkeypatch.setattr("app.agent.tools.llm_json_retry.call_llm", fail_if_called)

    # A genuinely valid pptx (python-pptx can open it) with a blank slide:
    # no text placeholders filled in, no embedded images.
    presentation = Presentation()
    presentation.slides.add_slide(presentation.slide_layouts[6])  # "Blank" layout
    buffer = io.BytesIO()
    presentation.save(buffer)
    empty_pptx_b64 = base64.b64encode(buffer.getvalue()).decode("ascii")

    with pytest.raises(UnprocessableResumeError, match="no usable content"):
        await run_resume_parsing_tool(empty_pptx_b64, "pptx")


@pytest.mark.asyncio
async def test_corrupt_file_fails_fast_without_retrying(monkeypatch):
    call_count = {"n": 0}

    async def fail_if_called(*args, **kwargs):
        call_count["n"] += 1
        raise AssertionError("should not call the LLM for an unreadable file")

    monkeypatch.setattr("app.agent.tools.llm_json_retry.call_llm", fail_if_called)

    with pytest.raises(UnprocessableResumeError, match="Could not read pdf resume file"):
        await run_resume_parsing_tool("not-valid-base64-or-a-pdf", "pdf")

    assert call_count["n"] == 0
