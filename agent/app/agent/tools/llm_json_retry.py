"""
Generic "call the LLM, parse its JSON, validate it, retry on failure" loop.

Both the text and vision resume-extraction paths need the exact same
retry-on-malformed-output behavior, so it's factored out here once instead
of duplicated per path. Any future tool that needs an LLM to emit one
validated JSON object can reuse this directly.
"""
import json
import logging
from dataclasses import dataclass
from typing import Callable, TypeVar

from pydantic import BaseModel, ValidationError

from app.agent.groq_client import call_llm
from app.config import settings
from app.logging_config import get_logger, log
from app.schemas import TokenUsage

logger = get_logger("agent.tools.llm_json_retry")

T = TypeVar("T", bound=BaseModel)

BuildMessages = Callable[[str], list[dict]]
"""Given feedback from the previous failed attempt ("" on the first try),
returns the `messages` list to send to the LLM."""


@dataclass
class LlmJsonOutcome:
    result: BaseModel
    retries: int
    latency_ms: int
    token_usage: TokenUsage


def _extract_json_object(raw_content: str) -> dict:
    """Models occasionally wrap JSON in prose or code fences despite
    instructions not to; salvage the first {...} block if present."""
    start, end = raw_content.find("{"), raw_content.rfind("}")
    candidate = raw_content[start : end + 1] if start != -1 and end != -1 else raw_content
    return json.loads(candidate)


async def run_llm_json_with_retries(
    build_messages: BuildMessages,
    validate: Callable[[dict], T],
    *,
    model: str | None = None,
    use_json_mode: bool = True,
    log_label: str = "llm_json",
) -> LlmJsonOutcome:
    """Calls the LLM, parses+validates its JSON response against `validate`,
    and retries — feeding the previous error back to the model — up to
    `settings.agent_max_retries` times before raising `ValueError`."""
    retries = 0
    latency_ms = 0
    token_usage = TokenUsage()
    error_feedback = ""

    for attempt in range(settings.agent_max_retries + 1):
        call_result = await call_llm(
            messages=build_messages(error_feedback),
            response_format={"type": "json_object"} if use_json_mode else None,
            temperature=0,
            model=model,
        )

        latency_ms += call_result.latency_ms
        token_usage.promptTokens += call_result.token_usage.promptTokens
        token_usage.completionTokens += call_result.token_usage.completionTokens
        token_usage.totalTokens += call_result.token_usage.totalTokens

        try:
            parsed_json = _extract_json_object(call_result.message.content or "")
            result = validate(parsed_json)
            return LlmJsonOutcome(result=result, retries=retries, latency_ms=latency_ms, token_usage=token_usage)
        except json.JSONDecodeError as err:
            error_feedback = f"Response was not valid JSON: {err}"
            reason = "invalid_json"
        except ValidationError as err:
            error_feedback = str(err)
            reason = "schema_validation_failed"

        retries += 1
        log(
            logger,
            logging.WARNING,
            "Malformed LLM output, retrying",
            event=f"{log_label}_retry",
            attempt=attempt,
            reason=reason,
        )

    raise ValueError(f"{log_label} failed after {settings.agent_max_retries + 1} attempts: {error_feedback}")
