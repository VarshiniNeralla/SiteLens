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
            }
        )
    return {"jobs": sorted(rows, key=lambda x: x["job_id"], reverse=True)}


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
