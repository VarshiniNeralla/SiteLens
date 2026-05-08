import re
import time
import asyncio
from pathlib import Path

from app.config import settings
from app.domain import ObservationRecord, ReportRecord
from app.logging_config import get_logger
from app.schemas.report import ReportOut
from app.services import excel_service, llm_service, observation_text, pdf_service, ppt_service
from app.services.circuit_breaker import get_breaker
from app.services.fault_injection import faults
from app.store import AppStore, utcnow

logger = get_logger(__name__)
_WINDOWS_FORBIDDEN = re.compile(r'[<>:"/\\|?*\x00-\x1F]')
_EXPORT_BREAKER = get_breaker("export_engine")


async def create_report_draft(
    store: AppStore,
    *,
    observation_ids: list[int],
    title: str | None,
    include_pdf: bool,
    status: str = "queued",
) -> ReportRecord:
    settings.reports_dir.mkdir(parents=True, exist_ok=True)
    unique_ids = list(dict.fromkeys(observation_ids))
    by_id: dict[int, ObservationRecord] = {}
    unknown: list[int] = []
    for oid in unique_ids:
        o = await store.get_observation(oid)
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
    summary_text = await llm_service.generate_report_summary_safe(proj_name, narrative_lines)
    pid = ordered[0].project_id
    rid = await store.allocate_report_id()
    oid_list = [o.id for o in ordered]
    draft = ReportRecord(
        id=rid,
        project_id=pid,
        title=report_title,
        status=status,
        pptx_path=None,
        pdf_path=None,
        xlsx_path=None,
        summary=summary_text,
        error_message=None,
        created_at=utcnow(),
        observation_ids=oid_list,
        include_pdf=include_pdf,
    )
    await store.upsert_report(draft)
    return draft


async def process_report_generation(
    store: AppStore,
    *,
    report_id: int,
) -> ReportOut:
    started = time.perf_counter()
    if not _EXPORT_BREAKER.allow():
        raise ValueError("Export service temporarily unavailable (circuit open)")
    mode = faults.apply("export")
    if mode == "outage":
        _EXPORT_BREAKER.record_failure(latency_ms=(time.perf_counter() - started) * 1000.0)
        raise ValueError("Injected export outage")
    report = await store.get_report(report_id)
    if report is None:
        raise ValueError(f"Report {report_id} not found")
    observations: list[ObservationRecord] = []
    for oid in report.observation_ids:
        obs = await store.get_observation(oid)
        if obs is None:
            raise ValueError(f"Observation {oid} not found")
        observations.append(obs)
    if not observations:
        raise ValueError("No observations supplied")
    project_names = {o.project_name for o in observations}
    proj_name = next(iter(project_names))

    export_base = _sanitize_export_basename(report.title)
    xlsx_export_base = sitelens_xlsx_stem(proj_name)
    ppt_path = _next_available_export_path(Path(settings.reports_dir), export_base, ".pptx")
    xlsx_path = _next_available_export_path(Path(settings.reports_dir), xlsx_export_base, ".xlsx")

    processing = ReportRecord(
        id=report.id,
        project_id=report.project_id,
        title=report.title,
        status="processing",
        pptx_path=None,
        pdf_path=None,
        xlsx_path=None,
        summary=report.summary,
        error_message=None,
        created_at=report.created_at,
        observation_ids=list(report.observation_ids),
        include_pdf=report.include_pdf,
    )
    await store.upsert_report(processing)

    try:
        if mode == "fail_after_ppt":
            # Build one artifact then fail to verify recovery and failed states.
            await asyncio.to_thread(
                ppt_service.build_quality_report_pptx,
                project_name=proj_name,
                title=report.title,
                observations=list(observations),
                output_path=ppt_path,
            )
            raise RuntimeError("Injected export failure after PPT generation")
        await asyncio.to_thread(
            ppt_service.build_quality_report_pptx,
            project_name=proj_name,
            title=report.title,
            observations=list(observations),
            output_path=ppt_path,
        )
        await asyncio.to_thread(excel_service.build_quality_observation_xlsx, observations=list(observations), output_path=xlsx_path)
        pptx_resolved = str(ppt_path.resolve())
        xlsx_resolved = str(xlsx_path.resolve())
        pdf_resolved: str | None = None
        pdf_note: list[str] = []

        if processing.include_pdf:
            try:
                pdf_path_obj = await asyncio.to_thread(pdf_service.pptx_to_pdf, ppt_path, Path(settings.reports_dir))
                pdf_resolved = str(pdf_path_obj.resolve())
            except FileNotFoundError as pdf_exc:
                # Microsoft-only environments commonly skip LibreOffice; keep report ready with PPTX.
                logger.warning("PDF export skipped: %s", pdf_exc)
                pdf_note.append(f"PDF export skipped: {pdf_exc}")
            except Exception as pdf_exc:  # noqa: BLE001
                logger.exception("PDF export failed (PPTX retained): %s", pdf_exc)
                pdf_note.append(f"PDF export failed: {pdf_exc}")

        updated = ReportRecord(
            id=processing.id,
            project_id=processing.project_id,
            title=processing.title,
            status="ready",
            pptx_path=pptx_resolved,
            pdf_path=pdf_resolved,
            xlsx_path=xlsx_resolved,
            summary=processing.summary,
            error_message="\n".join(pdf_note)[:1990] if pdf_note else None,
            created_at=processing.created_at,
            observation_ids=list(processing.observation_ids),
            include_pdf=processing.include_pdf,
        )
        await store.upsert_report(updated)
        _EXPORT_BREAKER.record_success(latency_ms=(time.perf_counter() - started) * 1000.0)
        return _report_to_out(updated)
    except Exception as e:  # noqa: BLE001
        _EXPORT_BREAKER.record_failure(latency_ms=(time.perf_counter() - started) * 1000.0)
        logger.exception("Report generation failed: %s", e)
        failed = ReportRecord(
            id=processing.id,
            project_id=processing.project_id,
            title=processing.title,
            status="failed",
            pptx_path=None,
            pdf_path=None,
            xlsx_path=None,
            summary=processing.summary,
            error_message=str(e)[:1990],
            created_at=processing.created_at,
            observation_ids=list(processing.observation_ids),
            include_pdf=processing.include_pdf,
        )
        await store.upsert_report(failed)
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
        include_pdf=r.include_pdf,
    )


async def list_reports(store: AppStore) -> list[ReportRecord]:
    return await store.list_reports_desc(limit=2000)


async def get_report(store: AppStore, report_id: int) -> ReportRecord | None:
    return await store.get_report(report_id)


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
