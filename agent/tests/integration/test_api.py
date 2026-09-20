import pytest
from fastapi.testclient import TestClient

from app.agent.orchestrator import AgentOutputValidationError, AgentTimeoutError
from app.main import app
from app.schemas import AgentOutput, RecommendationMetadata, Timings, TokenUsage
from tests.helpers import make_pdf_b64

client = TestClient(app)

TEST_API_KEY = "test-internal-api-key"
AUTH_HEADERS = {"X-Internal-Api-Key": TEST_API_KEY}

VALID_REQUEST = {
    "resumeFile": make_pdf_b64("5 years of React and Node.js experience, based in Remote."),
    "fileFormat": "pdf",
    "context": {
        "openingTitle": "Full Stack Developer",
        "requiredSkills": ["react", "node.js"],
        "experienceMin": 2,
        "experienceMax": 6,
        "openingLocation": "Remote",
        "contractType": "W2",
    },
}


@pytest.fixture(autouse=True)
def _configure_test_api_key(monkeypatch):
    """Every test in this file gets a known, hermetic API key configured
    — independent of whatever's actually in .env — so auth behavior is
    deterministic and unrelated to the real secret."""
    monkeypatch.setattr("app.security.settings.agent_service_api_key", TEST_API_KEY)


def fake_metadata() -> RecommendationMetadata:
    return RecommendationMetadata(
        trace=[],
        totalTokenUsage=TokenUsage(promptTokens=1, completionTokens=1, totalTokens=2),
        retries=0,
        timings=Timings(startedAt="2026-01-01T00:00:00Z", totalMs=42),
        agentVersion="1.0.0",
        model="mock-model",
    )


def test_health_check_does_not_require_auth():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_recommend_rejects_missing_api_key():
    response = client.post("/recommend", json=VALID_REQUEST)
    assert response.status_code == 401


def test_recommend_rejects_wrong_api_key():
    response = client.post("/recommend", json=VALID_REQUEST, headers={"X-Internal-Api-Key": "wrong-key"})
    assert response.status_code == 401


def test_recommend_fails_closed_when_no_key_is_configured(monkeypatch):
    monkeypatch.setattr("app.security.settings.agent_service_api_key", "")
    response = client.post("/recommend", json=VALID_REQUEST, headers=AUTH_HEADERS)
    assert response.status_code == 503


def test_recommend_returns_agent_output(monkeypatch):
    async def fake_run(resume_file_b64, file_format, context):
        output = AgentOutput(recommended=True, score=0.9, confidence=0.85, reason="Great match.")
        return output, fake_metadata()

    monkeypatch.setattr("app.main.run_recommendation_agent", fake_run)

    response = client.post("/recommend", json=VALID_REQUEST, headers=AUTH_HEADERS)

    assert response.status_code == 200
    body = response.json()
    assert body["output"]["recommended"] is True
    assert body["output"]["score"] == 0.9


def test_recommend_rejects_malformed_request():
    response = client.post("/recommend", json={"resumeFile": ""}, headers=AUTH_HEADERS)
    assert response.status_code == 422


def test_recommend_maps_timeout_to_504(monkeypatch):
    async def fake_run(resume_file_b64, file_format, context):
        raise AgentTimeoutError("timed out")

    monkeypatch.setattr("app.main.run_recommendation_agent", fake_run)

    response = client.post("/recommend", json=VALID_REQUEST, headers=AUTH_HEADERS)
    assert response.status_code == 504


def test_recommend_maps_validation_failure_to_502(monkeypatch):
    async def fake_run(resume_file_b64, file_format, context):
        raise AgentOutputValidationError("could not converge")

    monkeypatch.setattr("app.main.run_recommendation_agent", fake_run)

    response = client.post("/recommend", json=VALID_REQUEST, headers=AUTH_HEADERS)
    assert response.status_code == 502


def test_recommend_maps_unprocessable_resume_to_422(monkeypatch):
    async def fake_run(resume_file_b64, file_format, context):
        raise ValueError("Could not read pdf resume file: corrupt")

    monkeypatch.setattr("app.main.run_recommendation_agent", fake_run)

    response = client.post("/recommend", json=VALID_REQUEST, headers=AUTH_HEADERS)
    assert response.status_code == 422
