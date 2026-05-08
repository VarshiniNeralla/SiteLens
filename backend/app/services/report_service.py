import re
from pathlib import Path

from app.config import settings
from app.domain import ObservationRecord, ReportRecord
from app.logging_config import get_logger
from app.schemas.report import ReportOut
from app.services import excel_service, llm_service, observation_text, pdf_service, ppt_service
from app.store import AppStore, utcnow

logger = get_logger(__name__)
_WINDOWS_FORBIDDEN = re.compile(r'[<>:"/\\|?*\x00-\x1F]')


def generate_report_sync(
    store: AppStore,
    *,
    observation_ids: list[int],
    title: str | None,
    include_pdf: bool,
) -> ReportOut:
    settings.reports_dir.mkdir(parents=True, exist_ok=True)
    unique_ids = list(dict.fromkeys(observation_ids))
    by_id: dict[int, ObservationRecord] = {}
    unknown: list[int] = []
    for oid in unique_ids:
        o = store.get_observation(oid)
        if o is None:
            unknown.append(oid)
        else:
            by_id[oid] = o
    if unknown:
        raise ValueError(f"Unknown observation ids: {sorted(set(unknown))}")

    ordered: list[ObservationRecord] = []
    seen: set[int] = set()
    for oid in observation_ids:
        if oid in seen:
            continue
        ordered.append(by_id[oid])
        seen.add(oid)

    if not ordered:
        raise ValueError("No observations supplied")

    project_names = {o.project_name for o in ordered}
    if len(project_names) != 1:
        raise ValueError(
            "All observations in one report must belong to the same project. "
            f"Got distinct project names: {sorted(project_names)!r}"
        )
    proj_name = project_names.pop()

    report_title = title or f"Quality walkthrough — {proj_name}"
    narrative_lines = [observation_text.effective_observation_narrative(o) for o in ordered]
    summary_text = llm_service.generate_report_summary_safe(proj_name, narrative_lines)

    pid = ordered[0].project_id

    rid = store.allocate_report_id()
    export_base = _sanitize_export_basename(report_title)
    xlsx_export_base = sitelens_xlsx_stem(proj_name)
    ppt_path = _next_available_export_path(Path(settings.reports_dir), export_base, ".pptx")
    xlsx_path = _next_available_export_path(Path(settings.reports_dir), xlsx_export_base, ".xlsx")

    oid_list = [o.id for o in ordered]

    report = ReportRecord(
        id=rid,
        project_id=pid,
        title=report_title,
        status="draft",
        pptx_path=None,
        pdf_path=None,
        xlsx_path=None,
        summary=summary_text,
        error_message=None,
        created_at=utcnow(),
        observation_ids=oid_list,
    )
    store.upsert_report(report)

    try:
        ppt_service.build_quality_report_pptx(
            project_name=proj_name,
            title=report_title,
            observations=list(ordered),
            output_path=ppt_path,
        )
        excel_service.build_quality_observation_xlsx(observations=list(ordered), output_path=xlsx_path)
        pptx_resolved = str(ppt_path.resolve())
        xlsx_resolved = str(xlsx_path.resolve())
        pdf_resolved: str | None = None
        pdf_note: list[str] = []

        if include_pdf:
            try:
                pdf_path_obj = pdf_service.pptx_to_pdf(ppt_path, Path(settings.reports_dir))
                pdf_resolved = str(pdf_path_obj.resolve())
            except FileNotFoundError as pdf_exc:
                # Microsoft-only environments commonly skip LibreOffice; keep report ready with PPTX.
                logger.warning("PDF export skipped: %s", pdf_exc)
                pdf_note.append(f"PDF export skipped: {pdf_exc}")
            except Exception as pdf_exc:  # noqa: BLE001
                logger.exception("PDF export failed (PPTX retained): %s", pdf_exc)
                pdf_note.append(f"PDF export failed: {pdf_exc}")

        updated = ReportRecord(
            id=report.id,
            project_id=report.project_id,
            title=report.title,
            status="ready",
            pptx_path=pptx_resolved,
            pdf_path=pdf_resolved,
            xlsx_path=xlsx_resolved,
            summary=report.summary,
            error_message="\n".join(pdf_note)[:1990] if pdf_note else None,
            created_at=report.created_at,
            observation_ids=oid_list,
        )
        store.upsert_report(updated)
        return _report_to_out(updated)
    except Exception as e:  # noqa: BLE001
        logger.exception("Report generation failed: %s", e)
        failed = ReportRecord(
            id=report.id,
            project_id=report.project_id,
            title=report.title,
            status="failed",
            pptx_path=None,
            pdf_path=None,
            xlsx_path=None,
            summary=report.summary,
            error_message=str(e)[:1990],
            created_at=report.created_at,
            observation_ids=oid_list,
        )
        store.upsert_report(failed)
        return _report_to_out(failed)


def _report_to_out(r: ReportRecord) -> ReportOut:
    return ReportOut(
        id=r.id,
        project_id=r.project_id,
        title=r.title,
        status=r.status,
        pptx_path=r.pptx_path,
        pdf_path=r.pdf_path,
        xlsx_path=r.xlsx_path,
        summary=r.summary,
        error_message=r.error_message,
        created_at=r.created_at,
        observation_ids=r.observation_ids[:],
    )


def list_reports(store: AppStore) -> list[ReportRecord]:
    return store.list_reports_desc()


def get_report(store: AppStore, report_id: int) -> ReportRecord | None:
    return store.get_report(report_id)


def sitelens_xlsx_stem(project_name: str) -> str:
    slug = _sanitize_export_basename(project_name).replace(" ", "_").strip("_")
    if not slug:
        slug = "Observations"
    return f"SiteLens_Quality_Walkthrough_{slug}"


def _sanitize_export_basename(name: str) -> str:
    clean = _WINDOWS_FORBIDDEN.sub(" ", str(name or "").strip())
    clean = re.sub(r"\s+", " ", clean).strip().rstrip(". ")
    if not clean:
        clean = "Quality walkthrough"
    return clean[:120]


def _next_available_export_path(base_dir: Path, basename: str, suffix: str) -> Path:
    base_dir.mkdir(parents=True, exist_ok=True)
    candidate = base_dir / f"{basename}{suffix}"
    if not candidate.exists():
        return candidate
    version = 2
    while True:
        candidate = base_dir / f"{basename} ({version}){suffix}"
        if not candidate.exists():
            return candidate
        version += 1
