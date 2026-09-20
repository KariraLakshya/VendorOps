import os

from dotenv import load_dotenv

load_dotenv()


class Settings:
    """Process-wide configuration, read once at import time."""

    port: int = int(os.getenv("PORT", "8001"))

    # Shared secret the Node backend must send on every /recommend call
    # (header X-Internal-Api-Key). This service has no other auth of its
    # own and is not meant to be reachable from outside the private
    # network it shares with the Node backend — this key is the backstop
    # for when that network boundary isn't actually enforced (e.g. a
    # misconfigured deployment exposes this port publicly).
    agent_service_api_key: str = os.getenv("AGENT_SERVICE_API_KEY", "")

    groq_api_key: str | None = os.getenv("GROQ_API_KEY")
    # gpt-oss-120b: verified live on Groq (2026-09-20) — fast (~80ms),
    # confirmed tool-calling + json_object mode. Groq's catalog rotates
    # models fairly often; re-verify against
    # https://console.groq.com/docs/models if this ever starts 404ing.
    groq_model: str = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")

    # Vision-capable model used as a fallback when text extraction yields
    # too little content (scanned/image-based resumes). qwen/qwen3.8-27b
    # (open-weight) is verified live on Groq (2026-09-20): accepts image
    # content parts and correctly extracted structured fields from a
    # rendered scanned-resume PDF through the real resume_parsing_tool
    # pipeline (no mocks), ~1.2s, zero retries. Groq's catalog rotates —
    # if this ever starts 400ing on image content, re-check
    # https://console.groq.com/docs/vision for the current vision model.
    groq_vision_model: str = os.getenv("GROQ_VISION_MODEL", "qwen/qwen3.8-27b")

    agent_max_retries: int = int(os.getenv("AGENT_MAX_RETRIES", "2"))
    agent_timeout_ms: int = int(os.getenv("AGENT_TIMEOUT_MS", "15000"))

    # Below this many non-whitespace characters, extracted text is treated
    # as unreliable (likely a scanned/image-based document) and the vision
    # fallback is used instead.
    ocr_min_text_chars: int = int(os.getenv("OCR_MIN_TEXT_CHARS", "40"))
    # Hard cap on how many pages/images are sent to the vision model per
    # run, to bound latency and cost.
    ocr_max_images: int = int(os.getenv("OCR_MAX_IMAGES", "5"))

    log_level: str = os.getenv("LOG_LEVEL", "INFO")


settings = Settings()
