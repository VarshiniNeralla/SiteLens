from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse

from app.api.deps import get_store_dep
from app.domain import ReportRecord
from app.schemas.report import ReportGenerateRequest, ReportOut, ReportSummaryOut
from app.services.report_service import generate_report_sync, get_report, list_reports
from app.store import AppStore

router = APIRouter(prefix="/reports", tags=["reports"])


def _primary_project_name(store: AppStore, r: ReportRecord) -> str | None:
    for oid in r.observation_ids:
        obs = store.get_observation(oid)
        if obs and obs.project_name:
            return obs.project_name
    return None


@router.post("/generate", response_model=ReportOut)
def generate_report(
    payload: ReportGenerateRequest,
    store: AppStore = Depends(get_store_dep),
) -> ReportOut:
    try:
        return generate_report_sync(
            store,
            observation_ids=payload.observation_ids,
            title=payload.title,
            include_pdf=payload.include_pdf,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("", response_model=list[ReportSummaryOut])
def api_list_reports(store: AppStore = Depends(get_store_dep)) -> list[ReportSummaryOut]:
    rows = list_reports(store)
    return [
        ReportSummaryOut(
            id=r.id,
            project_id=r.project_id,
            title=r.title,
            status=r.status,
            created_at=r.created_at,
            has_pptx=r.pptx_path is not None and Path(r.pptx_path).is_file(),
            has_pdf=r.pdf_path is not None and Path(r.pdf_path).is_file(),
            primary_project_name=_primary_project_name(store, r),
        )
        for r in rows
    ]


def _detail_report(report: ReportRecord) -> ReportOut:
    return ReportOut(
        id=report.id,
        project_id=report.project_id,
        title=report.title,
        status=report.status,
        pptx_path=report.pptx_path,
        pdf_path=report.pdf_path,
        summary=report.summary,
        error_message=report.error_message,
        created_at=report.created_at,
        observation_ids=list(report.observation_ids),
    )


@router.get("/{report_id}", response_model=ReportOut)
def get_report_by_id(report_id: int, store: AppStore = Depends(get_store_dep)) -> ReportOut:
    row = get_report(store, report_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Report not found")
    return _detail_report(row)


@router.get("/{report_id}/download")
def download_report(
    report_id: int,
    file_format: str = Query("pptx", alias="format", description="pptx | pdf"),
    store: AppStore = Depends(get_store_dep),
) -> FileResponse:
    fmt = file_format.lower().strip()
    row = get_report(store, report_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Report not found")

    if fmt == "pptx":
        if not row.pptx_path:
            raise HTTPException(status_code=404, detail="Presentation not generated")
        p = Path(row.pptx_path)
        if not p.is_file():
            raise HTTPException(status_code=404, detail="Presentation file missing")
        return FileResponse(
            path=str(p),
            filename=p.name,
            media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        )
    if fmt == "pdf":
        if not row.pdf_path:
            raise HTTPException(status_code=404, detail="PDF not generated")
        p = Path(row.pdf_path)
        if not p.is_file():
            raise HTTPException(status_code=404, detail="PDF file missing")
        return FileResponse(path=str(p), filename=p.name, media_type="application/pdf")

    raise HTTPException(status_code=400, detail="Unsupported format")
