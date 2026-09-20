"""
Resume Parsing Tool.

Owns the entire "turn a resume file into structured fields" job:
1. Extract text from the file (PyMuPDF for PDF, python-pptx for PPTX —
   see resume_text_extractor.py).
2. Sanitize it against prompt injection.
3. If there's enough text, send it to the text model for structured
   extraction (LLM-backed, not regex, so it's meaningfully "invoked" by
   the orchestrating agent).
4. If there isn't (a strong signal of a scanned/image-based document),
   fall back to a vision-capable model on the rendered page/slide images
   — skipping a separate OCR step entirely. This requires
   GROQ_VISION_MODEL to be configured; if it isn't (no such model is
   currently available on Groq — see config.py), this fails with a clear
   error rather than attempting a request the API will just reject.

Both paths share the same bounded retry-on-malformed-output loop, see
llm_json_retry.py.
"""
import base64
import logging
from dataclasses import dataclass

from app.agent.prompt_sanitizer import sanitize_resume_text
from app.agent.resume_text_extractor import extract_resume_text
from app.agent.tools.llm_json_retry import run_llm_json_with_retries
from app.agent.tools.resume_parsing_prompts import build_text_messages, build_vision_messages
from app.agent.vision import render_resume_to_images
from app.config import settings
from app.logging_config import get_logger, log
from app.schemas import ParsedResume, TokenUsage

logger = get_logger("agent.tools.resume_parsing")


class UnprocessableResumeError(ValueError):
    """Raised for failures no amount of retrying will fix: a corrupt/
    unreadable file, or a scanned resume with no vision model configured.
    ToolDispatcher lets this propagate instead of feeding it back to the
    model as a retryable tool error — retrying an unfixable failure would
    just burn iterations until the agent times out anyway."""


@dataclass
class ResumeParsingOutcome:
    result: ParsedResume
    retries: int
    latency_ms: int
    token_usage: TokenUsage
    used_vision: bool = False


def _has_enough_text(sanitized_resume_text: str) -> bool:
    return len(sanitized_resume_text.strip()) >= settings.ocr_min_text_chars


async def _run_text_path(sanitized_text: str) -> ResumeParsingOutcome:
    outcome = await run_llm_json_with_retries(
        build_messages=lambda feedback: build_text_messages(sanitized_text, feedback),
        validate=ParsedResume.model_validate,
        log_label="resume_parsing_text",
    )
    return ResumeParsingOutcome(
        result=outcome.result,
        retries=outcome.retries,
        latency_ms=outcome.latency_ms,
        token_usage=outcome.token_usage,
        used_vision=False,
    )


async def _run_vision_path(file_bytes: bytes, file_format: str, extracted_chars: int) -> ResumeParsingOutcome:
    if not settings.groq_vision_model:
        raise UnprocessableResumeError(
            f"Extracted text was too thin ({extracted_chars} chars) to trust — this looks like a "
            "scanned or image-based resume — but no vision-capable model is configured "
            "(GROQ_VISION_MODEL is unset). OCR fallback is currently unavailable."
        )

    log(
        logger,
        logging.INFO,
        "Text extraction too thin, falling back to vision model",
        event="vision_fallback_triggered",
        extractedChars=extracted_chars,
        threshold=settings.ocr_min_text_chars,
    )

    images = render_resume_to_images(file_bytes, file_format, settings.ocr_max_images)
    if not images:
        # Nothing to show the vision model either (e.g. a pptx with no
        # embedded pictures and no text) — fail loudly rather than guess.
        raise UnprocessableResumeError(
            "Resume text extraction yielded no usable content and no images could be "
            "derived from the file for the vision fallback."
        )

    outcome = await run_llm_json_with_retries(
        build_messages=lambda feedback: build_vision_messages(images, feedback),
        validate=ParsedResume.model_validate,
        model=settings.groq_vision_model,
        use_json_mode=False,
        log_label="resume_parsing_vision",
    )
    return ResumeParsingOutcome(
        result=outcome.result,
        retries=outcome.retries,
        latency_ms=outcome.latency_ms,
        token_usage=outcome.token_usage,
        used_vision=True,
    )


async def run_resume_parsing_tool(resume_file_b64: str, file_format: str) -> ResumeParsingOutcome:
    try:
        file_bytes = base64.b64decode(resume_file_b64, validate=True)
        raw_text = extract_resume_text(file_bytes, file_format)
    except UnprocessableResumeError:
        raise
    except Exception as err:
        # A corrupt/malformed file (bad base64, PyMuPDF/python-pptx unable
        # to open it) is never fixable by retrying — fail fast.
        raise UnprocessableResumeError(f"Could not read {file_format} resume file: {err}") from err

    sanitized_text = sanitize_resume_text(raw_text)

    if _has_enough_text(sanitized_text):
        return await _run_text_path(sanitized_text)

    return await _run_vision_path(file_bytes, file_format, len(sanitized_text.strip()))
