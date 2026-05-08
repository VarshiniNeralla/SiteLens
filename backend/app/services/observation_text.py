"""Unified narrative resolution for AI vs manual observation text (exports, summaries)."""

from app.domain import ObservationRecord


def effective_observation_narrative(obs: ObservationRecord) -> str:
    g = (obs.generated_observation or "").strip()
    if g:
        return g
    return (obs.manually_written_observation or "").strip()


def effective_recommendation_narrative(obs: ObservationRecord) -> str:
    return (obs.generated_recommendation or "").strip()


def user_facing_notice(obs: ObservationRecord) -> str | None:
    """Short UX copy for APIs; avoids exposing raw LLM/stack traces."""
    s = (obs.ai_status or "").lower().strip()
    if s == "completed":
        return None
    if s == "skipped":
        return "Observation saved. AI drafting was skipped—you can add notes and export anytime."
    if s in {"unavailable", "failed"}:
        return (
            "Observation saved successfully. AI drafting is unavailable right now—you can continue "
            "working normally and export anytime."
        )
    return None
