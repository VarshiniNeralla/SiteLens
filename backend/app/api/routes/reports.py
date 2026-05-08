from pathlib import Path
import re

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse

from app.api.deps import get_store_dep
from app.domain import ReportRecord
from app.schemas.report import ReportGenerateRequest, ReportOut, ReportSummaryOut, ReportUpdateRequest
from app.services.report_service import generate_report_sync, get_report, list_reports, sitelens_xlsx_stem
from app.store import AppStore

router = APIRouter(prefix="/reports", tags=["reports"])
_WINDOWS_FORBIDDEN = re.compile(r'[<>:"/\\|?*\x00-\x1F]')


def _primary_project_name(store: AppStore, r: ReportRecord) -> str | None:
    for oid in r.observation_ids:
        obs = store.get_observation(oid)
        if obs and obs.project_name:
            return obs.project_name
    return None


def _sanitize_download_basename(name: str) -> str:
    clean = _WINDOWS_FORBIDDEN.sub(" ", str(name or "").strip())
    clean = re.sub(r"\s+", " ", clean).strip().rstrip(". ")
    if not clean:
        clean = "Quality walkthrough"
    return clean[:120]


def _build_download_basename(store: AppStore, row: ReportRecord) -> str:
    title = (row.title or "").strip()
    if not title:
        title = f"Quality walkthrough — Report {row.id}"
    # If multiple reports share title, append date for clear user-facing uniqueness.
    title_key = title.casefold()
    same_title_count = sum(1 for r in list_reports(store) if (r.title or "").strip().casefold() == title_key)
    if same_title_count > 1:
        title = f"{title} — {row.created_at.date().isoformat()}"
    return _sanitize_download_basename(title)


def _build_download_basename_for_format(store: AppStore, row: ReportRecord, fmt: str) -> str:
    fmt_norm = fmt.lower().strip()
    if fmt_norm == "xlsx":
        proj = _primary_project_name(store, row) or "Observations"
        base = sitelens_xlsx_stem(proj)
        same_project_reports = sum(
            1
            for r in list_reports(store)
            if (_primary_project_name(store, r) or "Observations").casefold() == proj.casefold()
        )
        if same_project_reports > 1:
            base = f"{base}_{row.created_at.date().isoformat()}"
        return base[:120]
    return _build_download_basename(store, row)


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
            has_xlsx=r.xlsx_path is not None and Path(r.xlsx_path).is_file(),
            primary_project_name=_primary_project_name(store, r),
            observation_count=len(r.observation_ids),
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
        xlsx_path=report.xlsx_path,
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
    file_format: str = Query("pptx", alias="format", description="pptx | pdf | xlsx"),
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
        download_name = f"{_build_download_basename_for_format(store, row, 'pptx')}.pptx"
        return FileResponse(
            path=str(p),
            filename=download_name,
            media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        )
    if fmt == "pdf":
        if not row.pdf_path:
            raise HTTPException(status_code=404, detail="PDF not generated")
        p = Path(row.pdf_path)
        if not p.is_file():
            raise HTTPException(status_code=404, detail="PDF file missing")
        download_name = f"{_build_download_basename_for_format(store, row, 'pdf')}.pdf"
        return FileResponse(path=str(p), filename=download_name, media_type="application/pdf")
    if fmt == "xlsx":
        if not row.xlsx_path:
            raise HTTPException(status_code=404, detail="Excel not generated")
        p = Path(row.xlsx_path)
        if not p.is_file():
            raise HTTPException(status_code=404, detail="Excel file missing")
        download_name = f"{_build_download_basename_for_format(store, row, 'xlsx')}.xlsx"
        return FileResponse(
            path=str(p),
            filename=download_name,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )

    raise HTTPException(status_code=400, detail="Unsupported format")


@router.patch("/{report_id}", response_model=ReportOut)
def rename_report(
    report_id: int,
    body: ReportUpdateRequest,
    store: AppStore = Depends(get_store_dep),
) -> ReportOut:
    row = get_report(store, report_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Report not found")
    updated = ReportRecord(
        id=row.id,
        project_id=row.project_id,
        title=body.title.strip(),
        status=row.status,
        pptx_path=row.pptx_path,
        pdf_path=row.pdf_path,
        xlsx_path=row.xlsx_path,
        summary=row.summary,
        error_message=row.error_message,
        created_at=row.created_at,
        observation_ids=list(row.observation_ids),
    )
    store.upsert_report(updated)
    return _detail_report(updated)


@router.delete("/{report_id}", status_code=204)
def delete_report(report_id: int, store: AppStore = Depends(get_store_dep)) -> None:
    row = store.delete_report(report_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Report not found")
    # Keep filesystem tidy, but failure to remove files should not block metadata delete.
    for p in [row.pptx_path, row.pdf_path, row.xlsx_path]:
        if not p:
            continue
        try:
            fp = Path(p)
            if fp.is_file():
                fp.unlink()
        except Exception:
            pass
    return None
