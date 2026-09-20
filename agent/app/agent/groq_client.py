import logging
import time
from dataclasses import dataclass, field
from typing import Any

from groq import AsyncGroq

from app.config import settings
from app.logging_config import get_logger, log
from app.schemas import TokenUsage

logger = get_logger("agent.groq_client")

_client: AsyncGroq | None = None


def get_client() -> AsyncGroq:
    global _client
    if _client is not None:
        return _client
    if not settings.groq_api_key:
        raise RuntimeError(
            "GROQ_API_KEY is not configured. The AI Recommendation Agent requires a Groq API key."
        )
    _client = AsyncGroq(api_key=settings.groq_api_key)
    return _client


@dataclass
class LlmCallResult:
    message: Any  # groq.types.chat.ChatCompletionMessage
    token_usage: TokenUsage
    latency_ms: int


async def call_llm(
    messages: list[dict],
    tools: list[dict] | None = None,
    tool_choice: str = "auto",
    response_format: dict | None = None,
    temperature: float = 0.2,
    model: str | None = None,
) -> LlmCallResult:
    """Single point of contact with the LLM. Every call is timed and its
    token usage logged, satisfying the "log token usage and latency"
    requirement regardless of which tool/step triggered the call.

    `model` defaults to the text model (`settings.groq_model`); pass
    `settings.groq_vision_model` explicitly for multimodal (image) calls.
    """
    client = get_client()
    started = time.perf_counter()
    resolved_model = model or settings.groq_model

    # Groq's API rejects `tool_choice`/`response_format` when explicitly
    # set to null rather than simply absent from the request (a live probe
    # confirmed a bare 400 "Only allowed string values for 'tool_choice'
    # are [none, auto, required]" when tools=None but tool_choice was sent
    # as null) — so these are only included in the request at all when
    # there's an actual value, never passed through as None.
    kwargs: dict[str, Any] = {
        "model": resolved_model,
        "messages": messages,
        "temperature": temperature,
    }
    if tools:
        kwargs["tools"] = tools
        kwargs["tool_choice"] = tool_choice
    if response_format:
        kwargs["response_format"] = response_format

    completion = await client.chat.completions.create(**kwargs)

    latency_ms = round((time.perf_counter() - started) * 1000)
    usage = completion.usage
    token_usage = TokenUsage(
        promptTokens=getattr(usage, "prompt_tokens", 0) or 0,
        completionTokens=getattr(usage, "completion_tokens", 0) or 0,
        totalTokens=getattr(usage, "total_tokens", 0) or 0,
    )

    log(
        logger,
        logging.INFO,
        "LLM call completed",
        event="llm_call",
        model=resolved_model,
        latencyMs=latency_ms,
        tokenUsage=token_usage.model_dump(),
    )

    message = completion.choices[0].message if completion.choices else None
    if message is None:
        raise RuntimeError("LLM response contained no choices")

    return LlmCallResult(message=message, token_usage=token_usage, latency_ms=latency_ms)


def message_to_dict(message) -> dict:
    """Converts a groq ChatCompletionMessage into the plain dict shape the
    API expects when it's fed back into the next call's `messages` list."""
    result: dict = {"role": "assistant", "content": message.content}
    if message.tool_calls:
        result["tool_calls"] = [
            {
                "id": tc.id,
                "type": "function",
                "function": {"name": tc.function.name, "arguments": tc.function.arguments},
            }
            for tc in message.tool_calls
        ]
    return result
