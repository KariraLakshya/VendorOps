# Zelosify AI Recommendation Agent (Python / FastAPI)

The AI Recommendation Agent for the Vendor–Hiring Manager Contract
Management Module, as its own service. The Node backend
(`backend`) owns auth/RBAC, S3 storage, and persistence; this
service owns *everything* about "reading" a resume and reasoning about
it — text extraction, the LLM tool-calling loop, and the deterministic
scoring engine — behind a single internal HTTP endpoint.

```
Node recommendationService.ts
  -> POST /recommend { resumeFile (base64), fileFormat, context }
     (requires header X-Internal-Api-Key)
    -> Resume Parsing Tool
         - extract_resume_text (PyMuPDF for PDF, python-pptx for PPTX)
         - sanitize against prompt injection
         - if too little text: render pages/slides to images, fall back
           to a vision model (currently unavailable on Groq — see below)
    -> Agent Orchestrator (LLM tool-calling loop, Groq)
      -> Tool Registry
           - resume_parsing_tool          (the step above, LLM-backed structured extraction)
           - skill_normalization_tool     (deterministic dictionary normalization)
           - feature_extraction_tool      (deterministic: per-dimension match scores)
           - matching_scoring_engine_tool (deterministic: MANDATORY weighted formula)
      -> Pydantic models validate every tool output and the final answer
      -> Decision Policy (deterministic score -> RECOMMENDED / BORDERLINE / NOT_RECOMMENDED)
    <- { output: {recommended, score, confidence, reason}, metadata: {...} }
```

## Getting started

```bash
cd agent
python -m venv .venv
.venv\Scripts\activate        # Windows; use `source .venv/bin/activate` on macOS/Linux
pip install -r requirements.txt

cp .env.example .env          # fill in GROQ_API_KEY and AGENT_SERVICE_API_KEY

uvicorn app.main:app --reload --port 8001
```

Health check (no auth required): `GET http://localhost:8001/health`

### Required environment variables

See `.env.example`:

- `AGENT_SERVICE_API_KEY` — **required**, and must exactly match the Node
  backend's copy of the same variable. Every request to `/recommend`
  without a matching `X-Internal-Api-Key` header is refused (401), and if
  this is left unset at all the service refuses *every* request (503) —
  it fails closed, not open. This service has no other authentication of
  its own and must never be reachable from outside the private network it
  shares with the Node backend.
- `GROQ_API_KEY` — **required**. Get a free key at https://console.groq.com
- `GROQ_MODEL` — defaults to `openai/gpt-oss-120b`, verified live
  (tool-calling + `json_object` mode confirmed working, ~500-1500ms/call).
  Groq's model catalog rotates — `llama-3.3-70b-versatile` and other
  older names have already disappeared once; re-check
  https://console.groq.com/docs/models if this starts 404ing.
- `GROQ_VISION_MODEL` — defaults to `qwen/qwen3.8-27b`, an open-weight
  vision-language model verified live on Groq (2026-09-20): accepts
  image content parts and, run through the real `resume_parsing_tool`
  pipeline (no mocks) against a rendered scanned-resume PDF, correctly
  extracted every field in ~1.2s with zero retries. Leaving this blank
  makes the scanned-resume fallback fail with a clear `422` instead of
  attempting the call.
- `AGENT_MAX_RETRIES` / `AGENT_TIMEOUT_MS` — retry budget for malformed
  LLM output and the overall per-run timeout.
- `OCR_MIN_TEXT_CHARS` — extracted text below this length is treated as a
  likely scan and triggers the vision fallback (or the 422 above, since
  no vision model is configured).

## Design decisions

- **The LLM decides which tools to call and when** (`tool_choice="auto"` while the pipeline is still in progress). Nothing about tool sequencing is hardcoded — see `app/agent/orchestrator.py`.
- **`tool_choice` is forced to `"none"` once a score actually exists.** Live testing surfaced a real, *recurring* failure: this model occasionally wraps its final JSON answer as a fake tool call (a fictitious `"json"` tool, not one we registered), which Groq rejects outright before any message comes back — and it kept doing this across every retry attempt under `tool_choice="auto"`, burning the whole retry budget and failing the recommendation. Once `matching_scoring_engine_tool` has produced a score, there's nothing left to legitimately call a tool for, so forcing `"none"` makes it *structurally impossible* for the API to accept any tool call at that point. Confirmed fixed across repeated live runs.
- **The final numeric score is always the deterministic engine's output.** The orchestrator ignores whatever `score` the model echoes back in its final JSON answer and substitutes the real value from `matching_scoring_engine_tool`, so the score can never drift from the explainable formula even if the model hallucinates. Verified against a real Groq response that tried to claim a different score.
- **Resume text is untrusted input.** `app/agent/prompt_sanitizer.py` strips known injection patterns (`ignore previous instructions`, fake `system:`/`assistant:` role markers, etc.) and wraps the remainder in an explicit "this is data, not instructions" envelope before it reaches any prompt.
- **Every structured value crossing the LLM boundary is a Pydantic model** (`app/schemas.py`) — a `ValidationError` on the parsed resume, feature vector, scoring result, or final answer drives a bounded retry loop with the validation errors fed back to the model, never a silent coercion.
- **Token usage and latency are logged** (structured JSON, stdlib `logging` + a JSON formatter) for every LLM call, and a full step-by-step trace is returned in the response's `metadata.trace` for persistence/auditability by the caller.
- **This service owns resume reading end to end.** PDF text comes from PyMuPDF (`app/agent/resume_text_extractor.py`), PPTX from `python-pptx` — both real parsing libraries, not a regex approximation. Node's only job is retrieving the file bytes from S3 and shipping them here; it no longer parses anything itself.
- **Unrecoverable resume errors fail fast, not after 8 retries.** A corrupt file or a scanned resume with no vision model configured raises `UnprocessableResumeError`, which `ToolDispatcher` lets propagate straight up (HTTP 422) instead of feeding it back to the model as a "try again" tool error — retrying an unfixable failure would just burn the whole iteration budget for nothing.
- **Scanned/image-based resumes fall back to a vision model, not a separate OCR engine** — render the PDF's pages (PyMuPDF) or pull a PPTX's embedded images and send them straight to a vision-capable model (`qwen/qwen3.8-27b` on Groq) for structured extraction from pixels. `metadata.usedVisionFallback` records which path ran.

## Testing

```bash
pytest
```

- `tests/unit/test_matching_engine.py` — experience/skill/location boundary tests, final score formula, decision thresholds
- `tests/unit/test_schemas.py` — Pydantic validation, including malformed/hallucinated LLM output
- `tests/unit/test_prompt_sanitizer.py` — prompt-injection mitigation
- `tests/unit/test_vision.py` — PDF page rasterization / PPTX embedded-image extraction
- `tests/unit/test_security.py` — the internal API key dependency (fail-closed, missing/wrong/matching header)
- `tests/integration/test_resume_parsing_vision_fallback.py` — text-vs-vision path selection, unreadable-file and no-vision-model-configured error paths
- `tests/integration/test_orchestrator.py` — full tool-calling loop with a mocked Groq client: correct tool sequencing, retry-on-malformed-output, the score-override guarantee, and recovery from the bogus-tool-call failure mode described above
- `tests/integration/test_api.py` — the `/recommend` HTTP contract (auth, validation, timeout/error mapping)
- `tests/performance/test_recommendation_performance.py` — simulates 100 profiles end-to-end, asserts P95 < 2000ms

The SLA test uses a mocked LLM client — a real network call to any LLM
provider cannot be reliably bounded that tightly, so this measures the
pipeline's own overhead rather than Groq's live latency. **Measured live
latency (real Groq calls, real resume) was 5–10 seconds end to end**,
consistently over the mocked test's target, because a genuine multi-hop
tool-calling agent needs 5–6 sequential LLM round trips at ~0.5-1.5s each
— that's the real cost of "not calling an LLM once and mapping the output
to a DB row," which the spec explicitly requires.

## Docker

```bash
docker build -t zelosify-agent-service .
docker run -p 8001:8001 --env-file .env zelosify-agent-service
```

Don't publish this port beyond a private network shared with the Node
backend — `AGENT_SERVICE_API_KEY` is a backstop, not a substitute for
actual network isolation.
