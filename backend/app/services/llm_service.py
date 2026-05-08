import json
import time
from dataclasses import dataclass

import httpx
from pydantic import ValidationError

from app.config import settings
from app.logging_config import get_logger
from app.services.llm.factory import get_llm_provider
from app.services.llm.schemas import LlmNormalizedResponse, ProviderHealth
from app.services.circuit_breaker import get_breaker
from app.services.fault_injection import faults

logger = get_logger(__name__)
_BREAKER = get_breaker("llm")

_AI_ERR_MAX = 480


@dataclass(frozen=True)
class LlmObservationDraftResult:
    observation: str
    recommendation: str
    ok: bool
    ai_status: str  # "completed" | "failed" | "unavailable"
    ai_error_public: str | None

_last_ai_response_ms: float | None = None
_last_ai_failure: str | None = None


def _provider() -> str:
    return (settings.llm_provider or "local").strip().lower()


def _normalize_fallback(provider_name: str) -> LlmNormalizedResponse:
    return LlmNormalizedResponse(
        observation="",
        severity="",
        recommendation="",
        confidence="",
        provider=provider_name,
    )


async def _invoke_provider(
    *,
    op: str,
    prompt: str,
    image_url: str | None = None,
    retry_on_malformed: bool = True,
) -> LlmNormalizedResponse:
    global _last_ai_response_ms, _last_ai_failure  # noqa: PLW0603
    if not _BREAKER.allow():
        raise RuntimeError("AI service temporarily unavailable (circuit open)")
    started = time.perf_counter()
    provider = get_llm_provider()
    mode = faults.apply("llm")
    if mode == "outage":
        _BREAKER.record_failure()
        _last_ai_failure = "Injected LLM outage"
        raise RuntimeError("Injected LLM outage")
    if mode == "malformed":
        _BREAKER.record_failure()
        _last_ai_failure = "Injected malformed LLM response"
        if retry_on_malformed:
            return await _invoke_provider(op=op, prompt=prompt, image_url=image_url, retry_on_malformed=False)
        return _normalize_fallback(provider.name)
    try:
        if op == "analyze_image":
            resp = await provider.analyze_image(prompt=prompt, image_url=image_url)
        elif op == "generate_recommendation":
            resp = await provider.generate_recommendation(prompt=prompt, image_url=image_url)
        else:
            resp = await provider.generate_observation(prompt=prompt, image_url=image_url)
        _last_ai_response_ms = (time.perf_counter() - started) * 1000.0
        _last_ai_failure = None
        _BREAKER.record_success(latency_ms=_last_ai_response_ms)
        return resp
    except (json.JSONDecodeError, ValidationError, ValueError) as exc:
        _BREAKER.record_failure(latency_ms=(time.perf_counter() - started) * 1000.0, retries=1 if retry_on_malformed else 0)
        _last_ai_failure = str(exc)
        if retry_on_malformed:
            return await _invoke_provider(op=op, prompt=prompt, image_url=image_url, retry_on_malformed=False)
        return _normalize_fallback(provider.name)
    except Exception:
        _BREAKER.record_failure(latency_ms=(time.perf_counter() - started) * 1000.0)
        _last_ai_failure = "provider_call_failed"
        raise


async def generate_observation_text_safe(
    *,
    tower: str,
    floor: str,
    flat: str,
    room: str,
    observation_type: str,
    severity: str,
    site_visit_date: str,
    slab_casting_date: str,
    inspection_status: str,
    third_party_status: str,
    image_url: str | None = None,
) -> LlmObservationDraftResult:
    """
    Never raises — observation persistence must never depend on the LLM.
    """
    try:
        obs, rec = await generate_observation_text(
            tower=tower,
            floor=floor,
            flat=flat,
            room=room,
            observation_type=observation_type,
            severity=severity,
            site_visit_date=site_visit_date,
            slab_casting_date=slab_casting_date,
            inspection_status=inspection_status,
            third_party_status=third_party_status,
            image_url=image_url,
        )
        if not (obs or rec):
            return LlmObservationDraftResult("", "", False, "unavailable", "AI response unavailable")
        return LlmObservationDraftResult(obs, rec, True, "completed", None)
    except ValueError as exc:
        msg = _short_exc(exc)
        logger.warning("Observation LLM parse/validation failure: %s", msg)
        return LlmObservationDraftResult("", "", False, "failed", msg)
    except httpx.HTTPError as exc:
        msg = _short_exc(exc)
        logger.warning("Observation LLM HTTP failure: %s", msg)
        return LlmObservationDraftResult("", "", False, "unavailable", msg)
    except Exception as exc:  # noqa: BLE001
        msg = _short_exc(exc)
        logger.exception("Observation LLM unexpected failure: %s", msg)
        return LlmObservationDraftResult("", "", False, "unavailable", msg)


async def generate_report_summary_safe(project_name: str, observation_notes: list[str]) -> str:
    try:
        out = await generate_report_summary(project_name, observation_notes)
        if not out.strip():
            return _fallback_exec_summary(project_name, observation_notes, "drafting returned empty output")
        return out
    except httpx.HTTPError as exc:
        logger.warning("Report summary LLM HTTP failure: %s", exc)
        return _fallback_exec_summary(project_name, observation_notes, "drafting service unreachable")
    except ValueError as exc:
        logger.warning("Report summary LLM response issue: %s", exc)
        return _fallback_exec_summary(project_name, observation_notes, "drafting returned an unexpected reply")
    except Exception as exc:  # noqa: BLE001
        logger.exception("Report summary LLM failed: %s", exc)
        return _fallback_exec_summary(project_name, observation_notes, "drafting unavailable")


def _fallback_exec_summary(project_name: str, observation_notes: list[str], cause: str) -> str:
    n = sum(1 for x in observation_notes if (x or "").strip())
    return (
        f"Executive summary unavailable ({cause}). Export still includes structured fields and attachments "
        f"for {project_name}: {n} observation(s)."
    )


def _short_exc(exc: BaseException) -> str:
    s = str(exc).strip().replace("\n", " ").replace("\r", " ")
    if len(s) > _AI_ERR_MAX:
        return s[: _AI_ERR_MAX - 1].rstrip() + "…"
    return s or type(exc).__name__


async def generate_observation_text(
    *,
    tower: str,
    floor: str,
    flat: str,
    room: str,
    observation_type: str,
    severity: str,
    site_visit_date: str,
    slab_casting_date: str,
    inspection_status: str,
    third_party_status: str,
    image_url: str | None = None,
) -> tuple[str, str]:
    user = f"""Analyze the construction observation carefully and draft inspection-grade text.

Tower: {tower or "—"}
Floor: {floor or "—"}
Flat: {flat or "—"}
Room: {room or "—"}
Observation type: {observation_type or "—"}
Severity: {severity or "—"}
Site visit date: {site_visit_date or "—"}
Slab casting date: {slab_casting_date or "—"}
Inspection status: {inspection_status or "—"}
Third party inspection status: {third_party_status or "—"}
Image URL (if available): {image_url or "—"}

Respond using exactly these section headers on their own lines, in this order:

OBSERVATION:

RECOMMENDATION:

Rules:
- If an image is available, inspect visible symptoms only (no hidden assumptions).
- Likely defect types can include: uneven surface, honeycombing, reinforcement exposure, cracks, improper finishing, leakage signs, alignment defects, bulging, or surface voids.
- Do not exaggerate severity; keep statements factual and concise.
- Recommendation must be actionable and construction QA oriented.
- If visual evidence is weak, explicitly keep language cautious.
- Keep each section concise (typically 3–6 sentences total across both sections unless severity is Critical)."""

    resp = await _invoke_provider(op="generate_observation", prompt=user, image_url=image_url)
    return (resp.observation.strip(), resp.recommendation.strip())


async def generate_report_summary(project_name: str, observation_notes: list[str]) -> str:
    joined = "\n".join(f"- {t}" for t in observation_notes if t.strip())
    user = f"""Project: {project_name}

Listed below are observation narratives already approved for inclusion in a formal walkthrough report. Produce ONE short executive summary (maximum 120 words).

Observations:

{joined if joined else "(none)"}

Respond with plain text only (no JSON, no bullet labels)."""

    resp = await _invoke_provider(op="generate_recommendation", prompt=user, image_url=None)
    return (resp.observation or resp.recommendation or "").strip()


async def provider_health_safe() -> ProviderHealth:
    try:
        health = await get_llm_provider().health_check()
        return health
    except Exception as exc:  # noqa: BLE001
        return ProviderHealth(provider=_provider(), available=False, latency_ms=None, detail=str(exc))


def provider_runtime_metrics() -> dict[str, object]:
    return {
        "active_provider": _provider(),
        "last_response_ms": round(_last_ai_response_ms, 1) if _last_ai_response_ms is not None else None,
        "last_failure": _last_ai_failure,
        "breaker": _BREAKER.snapshot(),
    }
