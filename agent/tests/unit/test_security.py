import pytest
from fastapi import HTTPException

from app.security import verify_internal_api_key


@pytest.mark.asyncio
async def test_fails_closed_when_no_key_configured(monkeypatch):
    monkeypatch.setattr("app.security.settings.agent_service_api_key", "")

    with pytest.raises(HTTPException) as exc_info:
        await verify_internal_api_key(x_internal_api_key="anything")

    assert exc_info.value.status_code == 503


@pytest.mark.asyncio
async def test_rejects_missing_header(monkeypatch):
    monkeypatch.setattr("app.security.settings.agent_service_api_key", "the-real-secret")

    with pytest.raises(HTTPException) as exc_info:
        await verify_internal_api_key(x_internal_api_key=None)

    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_rejects_wrong_header(monkeypatch):
    monkeypatch.setattr("app.security.settings.agent_service_api_key", "the-real-secret")

    with pytest.raises(HTTPException) as exc_info:
        await verify_internal_api_key(x_internal_api_key="not-the-real-secret")

    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_accepts_matching_header(monkeypatch):
    monkeypatch.setattr("app.security.settings.agent_service_api_key", "the-real-secret")

    await verify_internal_api_key(x_internal_api_key="the-real-secret")  # must not raise
