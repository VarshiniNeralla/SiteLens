from __future__ import annotations

import json
import time

import httpx

from app.config import settings
from app.services.llm.base import LlmProvider
from app.services.llm.schemas import LlmNormalizedResponse, ProviderHealth


GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"
SYSTEM_JSON_PROMPT = (
    "Return ONLY valid JSON object with keys: observation, severity, recommendation, confidence, provider."
)


class GroqProvider(LlmProvider):
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
        }
        async with httpx.AsyncClient(timeout=settings.llm_timeout_seconds) as client:
            resp = await client.post(GROQ_CHAT_URL, headers=self._headers(), json=payload)
            resp.raise_for_status()
            data = resp.json()
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
                    GROQ_CHAT_URL,
                    headers=self._headers(),
                    json={
                        "model": settings.llm_model,
                        "messages": [{"role": "user", "content": "Reply with JSON: {\"ok\":\"yes\"}"}],
                        "temperature": 0,
                    },
                )
                response.raise_for_status()
            latency = (time.perf_counter() - started) * 1000.0
            return ProviderHealth(provider=self.name, available=True, latency_ms=round(latency, 1), detail=None)
        except Exception as exc:  # noqa: BLE001
            return ProviderHealth(provider=self.name, available=False, latency_ms=None, detail=str(exc))
