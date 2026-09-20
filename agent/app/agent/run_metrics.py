"""Per-run bookkeeping for the orchestrator: elapsed time, token usage,
retries, and the step-by-step trace. Kept separate from SessionState (the
pipeline's artifacts, owned by ToolDispatcher) since this is purely
observability/timing data about the run itself."""
import time
from datetime import datetime, timezone

from app.agent.tool_dispatch import ToolDispatchResult
from app.schemas import AgentTraceEntry, Timings, TokenUsage


class RunMetrics:
    def __init__(self) -> None:
        self._started_at = time.perf_counter()
        self._started_at_iso = datetime.now(timezone.utc).isoformat()
        self.trace: list[AgentTraceEntry] = []
        self.total_token_usage = TokenUsage()
        self.total_retries = 0
        self._parsing_ms: int | None = None
        self._matching_ms: int | None = None

    def elapsed_ms(self) -> int:
        return round((time.perf_counter() - self._started_at) * 1000)

    def record_llm_call(self, step: int, call_result) -> None:
        self._add_usage(call_result.token_usage)
        self.trace.append(
            AgentTraceEntry(
                step=step,
                type="llm_call",
                name="orchestrator",
                durationMs=call_result.latency_ms,
                tokenUsage=call_result.token_usage,
            )
        )

    def record_tool_call(self, dispatch_result: ToolDispatchResult) -> None:
        self._add_usage(dispatch_result.token_usage)
        self.total_retries += dispatch_result.retries
        if dispatch_result.parsing_ms is not None:
            self._parsing_ms = (self._parsing_ms or 0) + dispatch_result.parsing_ms
        if dispatch_result.matching_ms is not None:
            self._matching_ms = (self._matching_ms or 0) + dispatch_result.matching_ms
        self.trace.append(dispatch_result.trace_entry)

    def record_retry(self) -> None:
        self.total_retries += 1

    def build_timings(self) -> Timings:
        return Timings(
            startedAt=self._started_at_iso,
            parsingMs=self._parsing_ms,
            matchingMs=self._matching_ms,
            totalMs=self.elapsed_ms(),
        )

    def _add_usage(self, usage: TokenUsage) -> None:
        self.total_token_usage.promptTokens += usage.promptTokens
        self.total_token_usage.completionTokens += usage.completionTokens
        self.total_token_usage.totalTokens += usage.totalTokens
