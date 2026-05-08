from __future__ import annotations

import json
import time

import httpx

from app.config import settings
from app.logging_config import get_logger
from app.services.llm.base import LlmProvider
from app.services.llm.schemas import LlmNormalizedResponse, ProviderHealth

logger = get_logger(__name__)

GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"
SYSTEM_JSON_PROMPT = (
    "Return ONLY valid JSON object with keys: observation, severity, recommendation, confidence, provider."
)


class GroqProvider(LlmProvider):
    @property
    def endpoint(self) -> str:
        # Groq endpoint is fixed; never derived from LLM_BASE_URL.
        return GROQ_CHAT_URL

    @property
    def name(self) -> str:
        return "groq"

    def _headers(self) -> dict[str, str]:
        key = settings.groq_api_key.strip()
        if not key:
            raise RuntimeError("GROQ_API_KEY is required when LLM_PROVIDER=groq")
        return {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    async def _chat(self, *, prompt: str, image_url: str | None = None) -> LlmNormalizedResponse:
        user_content: object
        if image_url:
            user_content = [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": image_url}},
            ]
        else:
            user_content = prompt
        payload = {
            "model": settings.llm_model,
            "messages": [
                {"role": "system", "content": SYSTEM_JSON_PROMPT},
                {"role": "user", "content": user_content},
            ],
            "temperature": 0.2,
            "max_tokens": settings.llm_max_tokens,
        }
        started = time.perf_counter()
        logger.info("LLM request provider=%s endpoint=%s model=%s", self.name, self.endpoint, settings.llm_model)
        async with httpx.AsyncClient(timeout=settings.llm_timeout_seconds) as client:
            resp = await client.post(self.endpoint, headers=self._headers(), json=payload)
            resp.raise_for_status()
            data = resp.json()
        elapsed = (time.perf_counter() - started) * 1000.0
        logger.info("LLM success provider=%s endpoint=%s latency_ms=%.1f", self.name, self.endpoint, elapsed)
        content = str(data["choices"][0]["message"]["content"]).strip()
        parsed = json.loads(content)
        parsed["provider"] = self.name
        return LlmNormalizedResponse.model_validate(parsed)

    async def analyze_image(self, *, prompt: str, image_url: str | None = None) -> LlmNormalizedResponse:
        return await self._chat(prompt=prompt, image_url=image_url)

    async def generate_observation(self, *, prompt: str, image_url: str | None = None) -> LlmNormalizedResponse:
        return await self._chat(prompt=prompt, image_url=image_url)

    async def generate_recommendation(self, *, prompt: str, image_url: str | None = None) -> LlmNormalizedResponse:
        return await self._chat(prompt=prompt, image_url=image_url)

    async def health_check(self) -> ProviderHealth:
        started = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=min(10.0, settings.llm_timeout_seconds)) as client:
                response = await client.post(
                    self.endpoint,
                    headers=self._headers(),
                    json={
                        "model": settings.llm_model,
                        "messages": [{"role": "user", "content": "Reply with JSON: {\"ok\":\"yes\"}"}],
                        "temperature": 0,
                        "max_tokens": 32,
                    },
                )
                response.raise_for_status()
            latency = (time.perf_counter() - started) * 1000.0
            return ProviderHealth(provider=self.name, available=True, latency_ms=round(latency, 1), detail=None)
        except Exception as exc:  # noqa: BLE001
            return ProviderHealth(provider=self.name, available=False, latency_ms=None, detail=str(exc))
