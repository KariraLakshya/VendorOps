"""
Executes one LLM-requested tool call against the deterministic pipeline.

ToolDispatcher owns the SessionState for a single recommendation run (the
parsed resume / feature vector / scoring result artifacts) and knows how
to run each of the four tools the agent is allowed to call. The
orchestrator only ever calls `dispatch()` — it doesn't know how any
individual tool works.
"""
import json
import logging
import time
from dataclasses import dataclass, field

from app.agent.session_state import SessionState
from app.agent.tool_registry import (
    FEATURE_EXTRACTION,
    MATCHING_SCORING_ENGINE,
    RESUME_PARSING,
    SKILL_NORMALIZATION,
)
from app.agent.tools.feature_extraction_tool import run_feature_extraction_tool
from app.agent.tools.matching_engine_tool import run_matching_engine_tool
from app.agent.tools.resume_parsing_tool import UnprocessableResumeError, run_resume_parsing_tool
from app.agent.tools.skill_normalization_tool import run_skill_normalization_tool
from app.logging_config import get_logger, log
from app.schemas import AgentTraceEntry, RecommendationContext, TokenUsage

logger = get_logger("agent.tool_dispatch")


@dataclass
class ToolOutcome:
    """What running one tool produced, before it's wrapped with trace/timing."""

    tool_result: dict
    retries: int = 0
    token_usage: TokenUsage = field(default_factory=TokenUsage)
    parsing_ms: int | None = None
    matching_ms: int | None = None


@dataclass
class ToolDispatchResult(ToolOutcome):
    """A ToolOutcome plus the trace entry `dispatch()` always attaches."""

    trace_entry: AgentTraceEntry | None = None


def _tool_error(message: str) -> ToolOutcome:
    return ToolOutcome(tool_result={"error": message})


class ToolDispatcher:
    def __init__(self, resume_file_b64: str, file_format: str, context: RecommendationContext) -> None:
        self._resume_file_b64 = resume_file_b64
        self._file_format = file_format
        self._context = context
        self.session = SessionState()

    async def dispatch(self, tool_call, step: int) -> ToolDispatchResult:
        name = tool_call.function.name
        started = time.perf_counter()
        args = self._parse_arguments(tool_call)

        try:
            outcome = await self._run_tool(name, args)
        except UnprocessableResumeError:
            # Not retryable — let it propagate to the orchestrator/caller
            # instead of burning iterations retrying an unfixable failure.
            raise
        except Exception as err:  # noqa: BLE001 — fed back to the model as a tool error, not raised
            log(logger, logging.ERROR, "Tool execution failed", event="tool_error", tool=name, step=step, error=str(err))
            outcome = _tool_error(str(err))

        trace_entry = AgentTraceEntry(
            step=step,
            type="tool_call",
            name=name,
            input=args,
            durationMs=round((time.perf_counter() - started) * 1000),
        )
        return ToolDispatchResult(**vars(outcome), trace_entry=trace_entry)

    @staticmethod
    def _parse_arguments(tool_call) -> dict:
        try:
            return json.loads(tool_call.function.arguments) if tool_call.function.arguments else {}
        except json.JSONDecodeError:
            return {}

    async def _run_tool(self, name: str, args: dict) -> ToolOutcome:
        if name == RESUME_PARSING:
            return await self._dispatch_resume_parsing()
        if name == SKILL_NORMALIZATION:
            return self._dispatch_skill_normalization(args)
        if name == FEATURE_EXTRACTION:
            return self._dispatch_feature_extraction()
        if name == MATCHING_SCORING_ENGINE:
            return self._dispatch_matching_scoring()
        return _tool_error(f"Unknown tool: {name}")

    async def _dispatch_resume_parsing(self) -> ToolOutcome:
        outcome = await run_resume_parsing_tool(self._resume_file_b64, self._file_format)
        self.session.parsed_resume = outcome.result
        self.session.used_vision_fallback = self.session.used_vision_fallback or outcome.used_vision

        log(
            logger,
            logging.INFO,
            "Resume parsing tool completed",
            event="tool_call",
            tool=RESUME_PARSING,
            durationMs=outcome.latency_ms,
            retries=outcome.retries,
            usedVision=outcome.used_vision,
        )
        return ToolOutcome(
            tool_result=outcome.result.model_dump(),
            retries=outcome.retries,
            token_usage=outcome.token_usage,
            parsing_ms=outcome.latency_ms,
        )

    def _dispatch_skill_normalization(self, args: dict) -> ToolOutcome:
        skills = args.get("skills") or (self.session.parsed_resume.skills if self.session.parsed_resume else [])
        if not skills:
            return _tool_error("No skills available yet. Call resume_parsing_tool first.")

        tool_result = run_skill_normalization_tool(skills)
        if self.session.parsed_resume:
            self.session.parsed_resume.normalizedSkills = tool_result["normalizedSkills"]
        return ToolOutcome(tool_result=tool_result)

    def _dispatch_feature_extraction(self) -> ToolOutcome:
        if not self.session.parsed_resume:
            return _tool_error("Resume has not been parsed yet. Call resume_parsing_tool first.")

        self.session.feature_vector = run_feature_extraction_tool(self.session.parsed_resume, self._context)
        return ToolOutcome(tool_result=self.session.feature_vector.model_dump())

    def _dispatch_matching_scoring(self) -> ToolOutcome:
        if not self.session.feature_vector:
            return _tool_error("Feature vector not available yet. Call feature_extraction_tool first.")

        started = time.perf_counter()
        self.session.scoring_result = run_matching_engine_tool(self.session.feature_vector)
        matching_ms = round((time.perf_counter() - started) * 1000)

        log(
            logger,
            logging.INFO,
            "Matching & scoring engine completed",
            event="tool_call",
            tool=MATCHING_SCORING_ENGINE,
            finalScore=self.session.scoring_result.finalScore,
        )
        return ToolOutcome(tool_result=self.session.scoring_result.model_dump(), matching_ms=matching_ms)
