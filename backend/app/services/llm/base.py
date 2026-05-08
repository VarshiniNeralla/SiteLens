from __future__ import annotations

from abc import ABC, abstractmethod

from app.services.llm.schemas import LlmNormalizedResponse, ProviderHealth


class LlmProvider(ABC):
    @property
    @abstractmethod
    def endpoint(self) -> str:
        raise NotImplementedError

    @property
    @abstractmethod
    def name(self) -> str:
        raise NotImplementedError

    @abstractmethod
    async def analyze_image(self, *, prompt: str, image_url: str | None = None) -> LlmNormalizedResponse:
        raise NotImplementedError

    @abstractmethod
    async def generate_observation(self, *, prompt: str, image_url: str | None = None) -> LlmNormalizedResponse:
        raise NotImplementedError

    @abstractmethod
    async def generate_recommendation(self, *, prompt: str, image_url: str | None = None) -> LlmNormalizedResponse:
        raise NotImplementedError

    @abstractmethod
    async def health_check(self) -> ProviderHealth:
        raise NotImplementedError
