"""
Agent Orchestrator — the LLM tool-calling loop.

Controller -> Recommendation Service -> (this) Agent Orchestrator ->
LLM Core (tool-calling) -> Tool Registry -> Schema Validator -> Decision
Policy -> caller persists the result.

This module only drives the loop: call the LLM, hand any tool calls to
ToolDispatcher, validate a final answer once the model stops calling
tools. The actual tool implementations, prompts, and per-run bookkeeping
each live in their own module (tool_dispatch.py, prompts.py, and
_RunMetrics below).
"""
import json
import logging

from groq import APIStatusError
from pydantic import ValidationError

from app.agent.groq_client import call_llm, message_to_dict
from app.agent.prompts import ORCHESTRATOR_SYSTEM_PROMPT, build_context_message
from app.agent.run_metrics import RunMetrics
from app.agent.tool_dispatch import ToolDispatcher
from app.agent.tool_registry import AGENT_TOOLS
from app.config import settings
from app.logging_config import get_logger, log
from app.scoring.matching_engine import decide_recommendation
from app.schemas import AgentOutput, RecommendationContext, RecommendationMetadata

logger = get_logger("agent.orchestrator")

AGENT_VERSION = "1.0.0"
MAX_TOOL_ITERATIONS = 8


class AgentTimeoutError(Exception):
    pass


class AgentOutputValidationError(Exception):
    pass


def _try_finalize(raw_content: str | None, dispatcher: ToolDispatcher) -> tuple[AgentOutput | None, str | None]:
    """Attempts to turn the model's final response into a validated
    AgentOutput. Returns (output, None) on success, or (None, feedback) if
    the model should be shown `feedback` and asked to retry."""
    try:
        parsed_output = json.loads(raw_content or "")
    except json.JSONDecodeError as err:
        return None, f"Your last response was not valid JSON ({err}). Respond with ONLY the required JSON object."

    try:
        validated = AgentOutput.model_validate(parsed_output)
    except ValidationError as err:
        log(logger, logging.WARNING, "Final agent output failed schema validation", event="final_output_retry", errors=err.errors())
        return None, f"Your response failed schema validation: {err}. Respond with ONLY corrected JSON matching the required schema."

    if not dispatcher.session.scoring_result:
        return None, (
            "You must call resume_parsing_tool, feature_extraction_tool, and "
            "matching_scoring_engine_tool before giving a final answer."
        )

    # Decision Policy: the deterministic score is the only source of truth,
    # regardless of what the model echoed back.
    scoring = dispatcher.session.scoring_result
    decision = decide_recommendation(scoring.finalScore)
    output = AgentOutput(
        recommended=decision == "RECOMMENDED",
        score=scoring.finalScore,
        confidence=validated.confidence,
        reason=validated.reason,
    )
    return output, None


def _build_metadata(metrics: RunMetrics, dispatcher: ToolDispatcher) -> RecommendationMetadata:
    session = dispatcher.session
    return RecommendationMetadata(
        trace=metrics.trace,
        totalTokenUsage=metrics.total_token_usage,
        retries=metrics.total_retries,
        parsedResume=session.parsed_resume,
        featureVector=session.feature_vector,
        scoring=session.scoring_result,
        timings=metrics.build_timings(),
        agentVersion=AGENT_VERSION,
        model=settings.groq_model,
        usedVisionFallback=session.used_vision_fallback,
    )


async def run_recommendation_agent(
    resume_file_b64: str,
    file_format: str,
    context: RecommendationContext,
) -> tuple[AgentOutput, RecommendationMetadata]:
    """Runs the full LLM tool-calling agent for one candidate/opening pair."""
    metrics = RunMetrics()
    dispatcher = ToolDispatcher(resume_file_b64, file_format, context)

    messages: list[dict] = [
        {"role": "system", "content": ORCHESTRATOR_SYSTEM_PROMPT},
        {"role": "user", "content": build_context_message(context)},
    ]

    final_output_retries = 0

    for iteration in range(1, MAX_TOOL_ITERATIONS + 1):
        if metrics.elapsed_ms() > settings.agent_timeout_ms:
            raise AgentTimeoutError(f"Recommendation agent exceeded timeout after {len(metrics.trace)} steps")

        # Once the deterministic pipeline has actually produced a score,
        # the model has nothing left to legitimately call a tool for.
        # Forcing tool_choice="none" here makes it *structurally*
        # impossible for the API to accept a tool call at all — including
        # the bogus "json" pseudo-tool some models reach for instead of
        # returning plain content, which was observed live to persist
        # across every retry attempt under tool_choice="auto" and burn
        # the entire retry budget without ever answering.
        tool_choice = "none" if dispatcher.session.scoring_result else "auto"

        try:
            call_result = await call_llm(messages=messages, tools=AGENT_TOOLS, tool_choice=tool_choice)
        except APIStatusError as err:
            # Observed live: some models occasionally wrap their intended
            # final JSON answer as a bogus tool call (e.g. a fictitious
            # "json" tool not in AGENT_TOOLS) instead of returning it as
            # plain content. Groq's API rejects the request outright (400)
            # before we ever get a message back, so there's nothing to
            # append to history except a corrective instruction — treated
            # like any other malformed-final-answer retry.
            final_output_retries += 1
            metrics.record_retry()
            log(logger, logging.WARNING, "LLM API rejected the request, retrying", event="llm_api_error_retry", error=str(err))
            messages.append(
                {
                    "role": "user",
                    "content": (
                        f"Your last response was rejected by the API ({err}). If you are ready to "
                        "give your final answer, return it as plain JSON content — do not call a "
                        "tool named 'json' or any tool outside the ones you were given."
                    ),
                }
            )
            if final_output_retries > settings.agent_max_retries:
                raise AgentOutputValidationError(f"LLM API repeatedly rejected the request: {err}") from err
            continue

        metrics.record_llm_call(iteration, call_result)
        messages.append(message_to_dict(call_result.message))

        if call_result.message.tool_calls:
            for tool_call in call_result.message.tool_calls:
                dispatch_result = await dispatcher.dispatch(tool_call, iteration)
                metrics.record_tool_call(dispatch_result)
                messages.append(
                    {"role": "tool", "tool_call_id": tool_call.id, "content": json.dumps(dispatch_result.tool_result)}
                )
            continue

        output, feedback = _try_finalize(call_result.message.content, dispatcher)
        if feedback:
            final_output_retries += 1
            metrics.record_retry()
            messages.append({"role": "user", "content": feedback})
            if final_output_retries > settings.agent_max_retries:
                raise AgentOutputValidationError(feedback)
            continue

        metadata = _build_metadata(metrics, dispatcher)
        log(
            logger,
            logging.INFO,
            "Recommendation agent run completed",
            event="recommendation_completed",
            finalScore=dispatcher.session.scoring_result.finalScore,
            totalMs=metadata.timings.totalMs,
            retries=metrics.total_retries,
            tokenUsage=metrics.total_token_usage.model_dump(),
        )
        return output, metadata

    raise AgentOutputValidationError(f"Agent did not converge to a final answer within {MAX_TOOL_ITERATIONS} iterations")
