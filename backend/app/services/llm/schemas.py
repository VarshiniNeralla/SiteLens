from __future__ import annotations

from pydantic import BaseModel, Field


class LlmNormalizedResponse(BaseModel):
    observation: str = Field(default="")
    severity: str = Field(default="")
    recommendation: str = Field(default="")
    confidence: str = Field(default="")
    provider: str = Field(default="")


class ProviderHealth(BaseModel):
    provider: str
    available: bool
    latency_ms: float | None = None
    detail: str | None = None
