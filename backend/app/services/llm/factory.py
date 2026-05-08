from __future__ import annotations

from app.config import settings
from app.services.llm.base import LlmProvider
from app.services.llm.groq_provider import GroqProvider
from app.services.llm.local_provider import LocalProvider


def get_llm_provider() -> LlmProvider:
    provider = (settings.llm_provider or "local").strip().lower()
    if provider == "groq":
        return GroqProvider()
    return LocalProvider()
