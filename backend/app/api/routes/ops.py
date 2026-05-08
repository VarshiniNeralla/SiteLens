from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.api.deps import get_store_dep
from app.services.circuit_breaker import all_breaker_snapshots
from app.services.fault_injection import faults
from app.services.report_jobs import job_manager
from app.services.upload_sessions import upload_sessions
from app.store import AppStore

router = APIRouter(prefix="/ops", tags=["ops"])


class FaultUpdate(BaseModel):
    target: str = Field(..., description="llm | cloudinary | export")
    enabled: bool = False
    latency_ms: int = 0
    mode: str = Field(default="none", description="none | outage | malformed | fail_after_ppt")


def _iso_utc(ts: float | None) -> str | None:
    if not ts:
        return None
    return datetime.fromtimestamp(ts, tz=UTC).isoformat()


def _service_health_from_breaker(name: str, snap: dict[str, object] | None) -> dict[str, object]:
    snap = snap or {}
    state = str(snap.get("state") or "closed").lower()
    consecutive = int(snap.get("consecutive_failures") or 0)
    success_rate = float(snap.get("success_rate") or 1.0)
    uptime_pct = float(snap.get("uptime_pct") or (success_rate * 100.0))
    avg_latency_ms = float(snap.get("avg_latency_ms") or 0.0)

    if state == "open":
        status = "offline"
        recovery_state = "recovering"
    elif state == "half-open":
        status = "recovering"
        recovery_state = "recovering"
    elif success_rate < 0.9 or consecutive >= 3:
        status = "degraded"
        recovery_state = "monitoring"
    elif success_rate < 0.98:
        status = "stable"
        recovery_state = "stable"
    else:
        status = "operational"
        recovery_state = "stable"

    return {
        "service": name,
        "status": status,
        "recovery_state": recovery_state,
        "uptime_pct": round(uptime_pct, 2),
        "avg_latency_ms": round(avg_latency_ms, 1) if avg_latency_ms > 0 else None,
        "success_rate_pct": round(success_rate * 100.0, 2),
        "retry_count": int(snap.get("total_retries") or 0),
        "recent_failures": int(snap.get("failures_in_window") or 0),
        "last_success_at": _iso_utc(snap.get("last_success_ts") if isinstance(snap, dict) else None),
        "last_failure_at": _iso_utc(snap.get("last_failure_ts") if isinstance(snap, dict) else None),
        "last_outage_at": _iso_utc(snap.get("last_outage_ts") if isinstance(snap, dict) else None),
        "last_recovery_at": _iso_utc(snap.get("last_recovery_ts") if isinstance(snap, dict) else None),
    }


@router.get("/health")
def ops_health(store: AppStore = Depends(get_store_dep)) -> dict[str, object]:
    reports = store.list_reports_desc()
    observations = store.list_observations()
    upload_sessions.cleanup_expired()
    active_uploads = len([s for s in upload_sessions.list_sessions() if s.status == "active"])
    return {
        "counts": {
            "reports_total": len(reports),
            "reports_queued_or_processing": len([r for r in reports if r.status in {"queued", "processing"}]),
            "reports_failed": len([r for r in reports if r.status == "failed"]),
            "observations_total": len(observations),
            "active_upload_sessions": active_uploads,
        },
        "breakers": all_breaker_snapshots(),
    }


@router.get("/jobs")
def ops_jobs() -> dict[str, object]:
    rows = []
    for state in job_manager.list():
        rows.append(
            {
                "job_id": state.job_id,
                "report_id": state.report_id,
                "status": state.status,
                "error": state.error,
                "created_at": state.created_at.isoformat() if state.created_at else None,
                "started_at": state.started_at.isoformat() if state.started_at else None,
                "finished_at": state.finished_at.isoformat() if state.finished_at else None,
            }
        )
    return {"jobs": sorted(rows, key=lambda x: x["job_id"], reverse=True)}


@router.get("/overview")
def ops_overview(store: AppStore = Depends(get_store_dep)) -> dict[str, object]:
    reports = store.list_reports_desc()
    observations = store.list_observations()
    upload_sessions.cleanup_expired()
    sessions = upload_sessions.list_sessions()
    active_uploads = len([s for s in sessions if s.status == "active"])
    breaker_map = {str(x.get("name")): x for x in all_breaker_snapshots()}
    deps = [
        _service_health_from_breaker("AI Engine", breaker_map.get("llm")),
        _service_health_from_breaker("Cloudinary", breaker_map.get("cloudinary")),
        _service_health_from_breaker("Export Engine", breaker_map.get("export_engine")),
    ]

    jobs = sorted(job_manager.list(), key=lambda x: x.created_at, reverse=True)
    completed_durations: list[float] = []
    for j in jobs:
        if j.started_at and j.finished_at:
            completed_durations.append(max(1.0, (j.finished_at - j.started_at).total_seconds()))
    avg_duration = (sum(completed_durations) / len(completed_durations)) if completed_durations else 90.0

    queued = [j for j in jobs if j.status == "queued"]
    processing = [j for j in jobs if j.status == "processing"]
    failed = [j for j in jobs if j.status == "failed"]
    total_jobs = len(jobs)
    success_jobs = len([j for j in jobs if j.status == "completed"])
    job_success_rate = (success_jobs / total_jobs) if total_jobs else 1.0
    upload_completed = len([s for s in sessions if s.status == "completed"])
    upload_success_rate = (upload_completed / len(sessions)) if sessions else 1.0
    dep_uptime = (sum(float(d["uptime_pct"]) for d in deps) / len(deps)) if deps else 100.0
    failure_pressure = min(1.0, (len(failed) + len([d for d in deps if d["status"] in {"offline", "degraded"}])) / 6.0)
    confidence = (
        (dep_uptime * 0.45)
        + (job_success_rate * 100.0 * 0.3)
        + (upload_success_rate * 100.0 * 0.15)
        + ((1.0 - failure_pressure) * 100.0 * 0.1)
    )
    confidence = max(0.0, min(100.0, confidence))

    job_rows: list[dict[str, object]] = []
    now = datetime.now(UTC)
    for idx, j in enumerate(queued, start=1):
        eta = int(max(15.0, avg_duration * idx))
        job_rows.append(
            {
                "job_id": j.job_id,
                "report_id": j.report_id,
                "status": j.status,
                "stage": "Queued",
                "progress_pct": 10,
                "queue_position": idx,
                "eta_seconds": eta,
                "retry_count": 0,
                "error": j.error,
                "started_at": j.started_at.isoformat() if j.started_at else None,
                "created_at": j.created_at.isoformat() if j.created_at else None,
            }
        )
    for j in processing:
        elapsed = max(0.0, (now - (j.started_at or j.created_at).replace(tzinfo=UTC)).total_seconds())
        progress = min(95, max(25, int((elapsed / max(1.0, avg_duration)) * 100)))
        eta = int(max(10.0, avg_duration - elapsed))
        job_rows.append(
            {
                "job_id": j.job_id,
                "report_id": j.report_id,
                "status": j.status,
                "stage": "Generating",
                "progress_pct": progress,
                "queue_position": 0,
                "eta_seconds": eta,
                "retry_count": 0,
                "error": j.error,
                "started_at": j.started_at.isoformat() if j.started_at else None,
                "created_at": j.created_at.isoformat() if j.created_at else None,
            }
        )
    for j in failed[:10]:
        job_rows.append(
            {
                "job_id": j.job_id,
                "report_id": j.report_id,
                "status": j.status,
                "stage": "Failed",
                "progress_pct": 100,
                "queue_position": 0,
                "eta_seconds": None,
                "retry_count": 0,
                "error": j.error,
                "started_at": j.started_at.isoformat() if j.started_at else None,
                "created_at": j.created_at.isoformat() if j.created_at else None,
            }
        )

    activity: list[dict[str, object]] = []
    for j in jobs[:8]:
        if j.status == "completed" and j.finished_at:
            activity.append({"type": "success", "message": f"Report export completed for report #{j.report_id}", "at": j.finished_at.isoformat()})
        elif j.status == "failed" and j.finished_at:
            activity.append({"type": "error", "message": f"Report export failed for report #{j.report_id}", "at": j.finished_at.isoformat()})
        elif j.status == "processing" and j.started_at:
            activity.append({"type": "info", "message": f"Report #{j.report_id} is currently generating", "at": j.started_at.isoformat()})
    for dep in deps:
        if dep["last_recovery_at"]:
            activity.append({"type": "success", "message": f"{dep['service']} recovered and is now stable", "at": dep["last_recovery_at"]})
        elif dep["status"] in {"offline", "degraded"} and dep["last_failure_at"]:
            activity.append({"type": "warning", "message": f"{dep['service']} is {dep['status'].replace('_', ' ')}", "at": dep["last_failure_at"]})
    activity = sorted(activity, key=lambda x: str(x.get("at") or ""), reverse=True)[:12]

    insights: list[str] = []
    if active_uploads == 0:
        insights.append("All upload systems are healthy.")
    else:
        insights.append(f"{active_uploads} upload session(s) are currently active.")
    if failed:
        insights.append(f"{len(failed)} report job(s) failed and require retry.")
    else:
        insights.append("Export pipeline is healthy across recent jobs.")
    for dep in deps:
        if dep["status"] == "operational":
            insights.append(f"{dep['service']} operating normally with {dep['uptime_pct']}% availability.")
        elif dep["status"] == "stable":
            insights.append(f"{dep['service']} stable with minor retry activity.")
        else:
            insights.append(f"{dep['service']} is {dep['status'].replace('_', ' ')}; fallback handling is active.")

    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "confidence": {
            "score_pct": round(confidence, 2),
            "label": "Stable" if confidence >= 95 else ("Watch" if confidence >= 85 else "At Risk"),
        },
        "counts": {
            "reports_total": len(reports),
            "reports_processing": len(queued) + len(processing),
            "reports_failed": len([r for r in reports if r.status == "failed"]),
            "observations_total": len(observations),
            "active_upload_sessions": active_uploads,
        },
        "dependencies": deps,
        "jobs": {
            "active": job_rows,
            "queued": len(queued),
            "processing": len(processing),
            "failed": len(failed),
            "avg_duration_seconds": round(avg_duration, 1),
            "success_rate_pct": round(job_success_rate * 100.0, 2),
        },
        "activity": activity,
        "insights": insights[:6],
    }


@router.get("/faults")
def ops_faults() -> dict[str, object]:
    return {"faults": faults.snapshot()}


@router.post("/faults")
def ops_set_fault(body: FaultUpdate) -> dict[str, object]:
    row = faults.set_fault(
        body.target.strip().lower(),
        enabled=body.enabled,
        latency_ms=body.latency_ms,
        mode=body.mode.strip().lower(),
    )
    return {"target": body.target.strip().lower(), "fault": row}


@router.post("/faults/reset")
def ops_reset_faults() -> dict[str, str]:
    faults.reset()
    return {"status": "ok"}
