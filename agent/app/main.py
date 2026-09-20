import logging

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import JSONResponse

from app.agent.orchestrator import (
    AgentOutputValidationError,
    AgentTimeoutError,
    run_recommendation_agent,
)
from app.logging_config import configure_logging, get_logger, log
from app.schemas import ErrorResponse, RecommendationRequest, RecommendationResponse
from app.security import verify_internal_api_key

configure_logging()
logger = get_logger("app.main")

app = FastAPI(
    title="Zelosify AI Recommendation Agent",
    description=(
        "LLM tool-calling agent that scores a candidate resume against a job "
        "opening's requirements. Called internally by the Node backend, which "
        "owns auth/RBAC, S3 storage, and persistence."
    ),
    version="1.0.0",
)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.post(
    "/recommend",
    response_model=RecommendationResponse,
    responses={
        401: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
        502: {"model": ErrorResponse},
        503: {"model": ErrorResponse},
        504: {"model": ErrorResponse},
    },
    dependencies=[Depends(verify_internal_api_key)],
)
async def recommend(request: RecommendationRequest) -> RecommendationResponse:
    """
    Runs the full AI Recommendation Agent for one candidate/opening pair.

    Requires the X-Internal-Api-Key header (see security.py) — this
    service is meant to be reachable only from the Node backend.

    The caller (the Node backend's Recommendation Service) is responsible
    only for fetching the resume file from S3 and persisting the result —
    this endpoint owns everything about "reading" the resume (text
    extraction, the vision fallback for scanned documents) and the agent's
    reasoning: prompt-injection mitigation, LLM tool-calling orchestration,
    deterministic scoring, and schema-validated output.
    """
    try:
        output, metadata = await run_recommendation_agent(request.resumeFile, request.fileFormat, request.context)
        return RecommendationResponse(output=output, metadata=metadata)
    except AgentTimeoutError as err:
        log(logger, logging.ERROR, "Agent timed out", event="agent_timeout", error=str(err))
        raise HTTPException(status_code=504, detail=str(err)) from err
    except AgentOutputValidationError as err:
        log(logger, logging.ERROR, "Agent failed to produce valid output", event="agent_validation_failed", error=str(err))
        raise HTTPException(status_code=502, detail=str(err)) from err
    except ValueError as err:
        # e.g. an unreadable/corrupt file, or a scanned resume with no
        # vision model configured to fall back to.
        log(logger, logging.WARNING, "Resume could not be processed", event="unprocessable_resume", error=str(err))
        raise HTTPException(status_code=422, detail=str(err)) from err
    except RuntimeError as err:
        # e.g. GROQ_API_KEY missing/misconfigured
        log(logger, logging.ERROR, "Agent misconfigured", event="agent_config_error", error=str(err))
        raise HTTPException(status_code=500, detail=str(err)) from err


@app.exception_handler(Exception)
async def unhandled_exception_handler(request, exc: Exception) -> JSONResponse:
    log(logger, logging.ERROR, "Unhandled exception", event="unhandled_error", error=str(exc))
    return JSONResponse(status_code=500, content={"error": "Internal server error", "message": str(exc)})
