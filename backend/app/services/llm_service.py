import re

import httpx

from app.config import llm_chat_completions_url, settings
from app.logging_config import get_logger

logger = get_logger(__name__)

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


def parse_observation_and_recommendation(raw: str) -> tuple[str, str]:
    obs_m = re.search(
        r"(?is)OBSERVATION:\s*(.*?)(?=RECOMMENDATION:|$)",
        raw,
    )
    rec_m = re.search(r"(?is)RECOMMENDATION:\s*(.*)$", raw)
    observation = obs_m.group(1).strip() if obs_m else raw.strip()
    recommendation = rec_m.group(1).strip() if rec_m else ""
    return observation, recommendation


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
) -> tuple[str, str]:
    user = f"""Based ONLY on the following factual fields recorded on site, draft report-ready wording.

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

Respond using exactly these section headers on their own lines, in this order:

OBSERVATION:

RECOMMENDATION:

Rules:
- Describe only what the fields state; do not infer causes or dimensions not explicitly provided.
- Keep each section concise (typically 3–6 sentences total across both sections unless severity is Critical.
- Formal QA tone."""

    raw = _chat(
        [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user},
        ]
    )
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
