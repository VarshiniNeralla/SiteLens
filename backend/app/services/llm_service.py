import re
from dataclasses import dataclass

import httpx

from app.config import llm_chat_completions_url, settings
from app.logging_config import get_logger

logger = get_logger(__name__)

_AI_ERR_MAX = 480


@dataclass(frozen=True)
class LlmObservationDraftResult:
    observation: str
    recommendation: str
    ok: bool
    ai_status: str  # "completed" | "failed" | "unavailable"
    ai_error_public: str | None

SYSTEM_PROMPT = """You are a professional construction quality walkthrough reporting assistant.

Your role:

* generate concise technical observations
* maintain formal engineering language
* avoid hallucinations
* avoid assumptions
* never fabricate measurements
* generate short professional recommendations
* use clean report-ready formatting

Severity levels:

* Minor
* Moderate
* Major
* Critical"""


def _chat(messages: list[dict[str, str]]) -> str:
    url = llm_chat_completions_url()
    payload = {
        "model": settings.llm_model,
        "messages": messages,
        "temperature": 0.2,
    }
    logger.info("LLM POST %s (model=%s)", url, settings.llm_model)
    with httpx.Client(timeout=settings.llm_timeout_seconds) as client:
        r = client.post(url, json=payload)
        if not r.is_success:
            logger.error(
                "LLM HTTP %s — body snippet: %.500s",
                r.status_code,
                (r.text or "")[:500],
            )
        r.raise_for_status()
        data = r.json()
    try:
        return str(data["choices"][0]["message"]["content"]).strip()
    except (KeyError, IndexError, TypeError) as e:
        logger.error("Unexpected LLM response shape: %s", data)
        raise ValueError("Invalid response from language model") from e


def _chat_with_maybe_image(*, text_prompt: str, image_url: str | None) -> str:
    """
    Try multimodal chat when an HTTP image URL exists.
    Falls back to text-only chat for models/endpoints that don't support image parts.
    """
    if not image_url:
        return _chat(
            [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": text_prompt},
            ]
        )

    url = llm_chat_completions_url()
    payload = {
        "model": settings.llm_model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": text_prompt},
                    {"type": "image_url", "image_url": {"url": image_url}},
                ],
            },
        ],
        "temperature": 0.2,
    }
    try:
        with httpx.Client(timeout=settings.llm_timeout_seconds) as client:
            r = client.post(url, json=payload)
            if not r.is_success:
                logger.warning("Multimodal draft HTTP %s; falling back to text-only", r.status_code)
                r.raise_for_status()
            data = r.json()
        return str(data["choices"][0]["message"]["content"]).strip()
    except Exception as exc:  # noqa: BLE001
        logger.info("Multimodal draft unavailable (%s); retrying text-only.", exc)
        return _chat(
            [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": text_prompt},
            ]
        )


def parse_observation_and_recommendation(raw: str) -> tuple[str, str]:
    obs_m = re.search(
        r"(?is)OBSERVATION:\s*(.*?)(?=RECOMMENDATION:|$)",
        raw,
    )
    rec_m = re.search(r"(?is)RECOMMENDATION:\s*(.*)$", raw)
    observation = obs_m.group(1).strip() if obs_m else raw.strip()
    recommendation = rec_m.group(1).strip() if rec_m else ""
    return observation, recommendation


def generate_observation_text_safe(
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
        obs, rec = generate_observation_text(
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


def generate_report_summary_safe(project_name: str, observation_notes: list[str]) -> str:
    try:
        return generate_report_summary(project_name, observation_notes)
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


def generate_observation_text(
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

    raw = _chat_with_maybe_image(text_prompt=user, image_url=image_url)
    return parse_observation_and_recommendation(raw)


def generate_report_summary(project_name: str, observation_notes: list[str]) -> str:
    joined = "\n".join(f"- {t}" for t in observation_notes if t.strip())
    user = f"""Project: {project_name}

Listed below are observation narratives already approved for inclusion in a formal walkthrough report. Produce ONE short executive summary (maximum 120 words).

Observations:

{joined if joined else "(none)"}

Respond with plain text only (no JSON, no bullet labels)."""

    return _chat(
        [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user},
        ]
    )
