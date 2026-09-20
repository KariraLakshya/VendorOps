"""
Internal-service authentication.

This service has no user-facing auth of its own — it's meant to be
reachable only from the Node backend over a private network. That network
boundary is a deployment concern this code can't enforce by itself, so as
a backstop every request must also carry a shared-secret header matching
AGENT_SERVICE_API_KEY. Fails closed: if the operator hasn't configured a
key at all, every request is refused rather than silently left open.
"""
import hmac

from fastapi import Header, HTTPException, status

from app.config import settings

INTERNAL_API_KEY_HEADER = "X-Internal-Api-Key"


async def verify_internal_api_key(x_internal_api_key: str | None = Header(default=None)) -> None:
    if not settings.agent_service_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Agent service has no AGENT_SERVICE_API_KEY configured",
        )

    if not x_internal_api_key or not hmac.compare_digest(x_internal_api_key, settings.agent_service_api_key):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or missing internal API key")
