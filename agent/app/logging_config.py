import json
import logging
import sys
import time
from typing import Any

from app.config import settings


class JsonFormatter(logging.Formatter):
    """Structured JSON log formatter — Observability requires structured
    JSON logs only (start time, parsing time, matching time, final score,
    errors), never free-text lines."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "level": record.levelname,
            "time": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created)),
            "service": "zelosify-agent-service",
            "logger": record.name,
            "msg": record.getMessage(),
        }
        extra = getattr(record, "fields", None)
        if isinstance(extra, dict):
            payload.update(extra)
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload)


def configure_logging() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())

    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(settings.log_level)


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)


def log(logger: logging.Logger, level: int, msg: str, **fields: Any) -> None:
    """Convenience helper so call sites read like `log(logger, INFO, "...",
    event="tool_call", tool=name, durationMs=12)` instead of juggling the
    stdlib `extra={"fields": {...}}` wrapping every time."""
    logger.log(level, msg, extra={"fields": fields})
