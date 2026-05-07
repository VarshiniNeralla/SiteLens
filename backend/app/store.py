"""JSON-backed persistence under data/ — no SQL database."""

from __future__ import annotations

import json
import threading
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from app.config import settings
from app.domain import ObservationRecord, ReportRecord
from app.logging_config import get_logger

logger = get_logger(__name__)

_store_singleton: AppStore | None = None
_init_lock = threading.Lock()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _parse_datetime(raw: str) -> datetime:
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    dt = datetime.fromisoformat(raw)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


class AppStore:
    """Thread-safe KV store persisted as one JSON file."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.Lock()
        self._projects: dict[str, int] = {}
        self._project_seq = 0
        self._observations: dict[int, ObservationRecord] = {}
        self._obs_seq = 0
        self._reports: dict[int, ReportRecord] = {}
        self._report_seq = 0

    def ensure_loaded(self) -> None:
        with self._lock:
            self._load_unlocked()

    def _load_unlocked(self) -> None:
        if not self.path.is_file():
            logger.info("No existing datastore (%s); using empty counters.", self.path)
            return
        raw = json.loads(self.path.read_text(encoding="utf-8"))
        self._projects = {str(k): int(v) for k, v in raw.get("projects", {}).items()}
        self._project_seq = int(raw.get("project_seq", 0))
        self._obs_seq = int(raw.get("observation_seq", 0))
        self._report_seq = int(raw.get("report_seq", 0))
        self._observations.clear()
        max_oid = self._obs_seq
        for v in raw.get("observations", {}).values():
            o = self._parse_observation(v)
            self._observations[o.id] = o
            max_oid = max(max_oid, o.id)
        self._obs_seq = max(self._obs_seq, max_oid)

        self._reports.clear()
        max_rid = self._report_seq
        for v in raw.get("reports", {}).values():
            r = self._parse_report(v)
            self._reports[r.id] = r
            max_rid = max(max_rid, r.id)
        self._report_seq = max(self._report_seq, max_rid)

    def _dump_observation(self, o: ObservationRecord) -> dict[str, Any]:
        return {
            "id": o.id,
            "project_id": o.project_id,
            "project_name": o.project_name,
            "tower": o.tower,
            "floor": o.floor,
            "flat": o.flat,
            "room": o.room,
            "observation_type": o.observation_type,
            "severity": o.severity,
            "site_visit_date": o.site_visit_date.isoformat() if o.site_visit_date else None,
            "slab_casting_date": o.slab_casting_date.isoformat() if o.slab_casting_date else None,
            "inspection_status": o.inspection_status,
            "third_party_status": o.third_party_status,
            "image_path": o.image_path,
            "generated_observation": o.generated_observation,
            "generated_recommendation": o.generated_recommendation,
            "created_at": o.created_at.isoformat(),
        }

    def _parse_observation(self, d: dict[str, Any]) -> ObservationRecord:
        return ObservationRecord(
            id=int(d["id"]),
            project_id=int(d["project_id"]),
            project_name=str(d.get("project_name", "")),
            tower=str(d.get("tower", "")),
            floor=str(d.get("floor", "")),
            flat=str(d.get("flat", "")),
            room=str(d.get("room", "")),
            observation_type=str(d.get("observation_type", "")),
            severity=str(d.get("severity", "")),
            site_visit_date=date.fromisoformat(str(d["site_visit_date"])) if d.get("site_visit_date") else None,
            slab_casting_date=date.fromisoformat(str(d["slab_casting_date"]))
            if d.get("slab_casting_date")
            else None,
            inspection_status=str(d.get("inspection_status", "")),
            third_party_status=str(d.get("third_party_status", "")),
            image_path=str(d["image_path"]),
            generated_observation=str(d.get("generated_observation", "")),
            generated_recommendation=str(d.get("generated_recommendation", "")),
            created_at=_parse_datetime(str(d["created_at"])),
        )

    def _dump_report(self, r: ReportRecord) -> dict[str, Any]:
        return {
            "id": r.id,
            "project_id": r.project_id,
            "title": r.title,
            "status": r.status,
            "pptx_path": r.pptx_path,
            "pdf_path": r.pdf_path,
            "summary": r.summary,
            "error_message": r.error_message,
            "created_at": r.created_at.isoformat(),
            "observation_ids": list(r.observation_ids),
        }

    def _parse_report(self, d: dict[str, Any]) -> ReportRecord:
        return ReportRecord(
            id=int(d["id"]),
            project_id=int(d["project_id"]),
            title=str(d["title"]),
            status=str(d["status"]),
            pptx_path=d.get("pptx_path"),
            pdf_path=d.get("pdf_path"),
            summary=d.get("summary"),
            error_message=d.get("error_message"),
            created_at=_parse_datetime(str(d["created_at"])),
            observation_ids=[int(x) for x in d.get("observation_ids", [])],
        )

    def _persist_unlocked(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        blob = {
            "projects": self._projects,
            "project_seq": self._project_seq,
            "observation_seq": self._obs_seq,
            "report_seq": self._report_seq,
            "observations": {
                str(oid): self._dump_observation(o) for oid, o in sorted(self._observations.items())
            },
            "reports": {str(rid): self._dump_report(r) for rid, r in sorted(self._reports.items())},
        }
        self.path.write_text(json.dumps(blob, indent=2), encoding="utf-8")

    def project_id_for_name(self, name: str) -> int:
        key = name.strip()
        if not key:
            raise ValueError("Project name cannot be empty")
        with self._lock:
            mutated = False
            if key not in self._projects:
                self._project_seq += 1
                self._projects[key] = self._project_seq
                mutated = True
            pid = self._projects[key]
            if mutated:
                self._persist_unlocked()
            return pid

    def persist(self) -> None:
        """Force flush (normally called after mutations that already persist)."""
        with self._lock:
            self._persist_unlocked()

    def allocate_observation_id(self) -> int:
        with self._lock:
            self._obs_seq += 1
            return self._obs_seq

    def add_observation(self, obs: ObservationRecord) -> ObservationRecord:
        with self._lock:
            self._obs_seq = max(self._obs_seq, obs.id)
            self._observations[obs.id] = obs
            self._persist_unlocked()
        return obs

    def list_observations(self, project_id: int | None = None) -> list[ObservationRecord]:
        with self._lock:
            rows = list(self._observations.values())
        rows.sort(key=lambda o: o.id, reverse=True)
        if project_id is None:
            return rows
        return [o for o in rows if o.project_id == project_id]

    def get_observation(self, oid: int) -> ObservationRecord | None:
        with self._lock:
            return self._observations.get(oid)

    def replace_observation(self, obs: ObservationRecord) -> None:
        with self._lock:
            self._observations[obs.id] = obs
            self._persist_unlocked()

    def allocate_report_id(self) -> int:
        with self._lock:
            self._report_seq += 1
            return self._report_seq

    def upsert_report(self, r: ReportRecord) -> ReportRecord:
        with self._lock:
            self._report_seq = max(self._report_seq, r.id)
            self._reports[r.id] = r
            self._persist_unlocked()
        return r

    def get_report(self, rid: int) -> ReportRecord | None:
        with self._lock:
            return self._reports.get(rid)

    def list_reports_desc(self) -> list[ReportRecord]:
        with self._lock:
            rows = list(self._reports.values())
        rows.sort(key=lambda r: r.id, reverse=True)
        return rows


def get_store() -> AppStore:
    global _store_singleton  # noqa: PLW0603
    if _store_singleton is None:
        with _init_lock:
            if _store_singleton is None:
                path = Path(settings.data_dir) / "app_store.json"
                store = AppStore(path)
                store.ensure_loaded()
                _store_singleton = store
                logger.info("Datastore file: %s", path.resolve())
    return _store_singleton
