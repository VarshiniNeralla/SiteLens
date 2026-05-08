from __future__ import annotations

from app.config import settings
from app.logging_config import get_logger
from app.services.llm.base import LlmProvider
from app.services.llm.groq_provider import GroqProvider
from app.services.llm.local_provider import LocalProvider

logger = get_logger(__name__)


def get_llm_provider() -> LlmProvider:
    provider = (settings.llm_provider or "local").strip().lower()
    if provider == "groq":
        selected: LlmProvider = GroqProvider()
    else:
        selected = LocalProvider()
    logger.info("LLM provider selected provider=%s endpoint=%s", selected.name, selected.endpoint)
    return selected
