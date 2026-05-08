from __future__ import annotations

import threading
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime
from typing import Callable
from uuid import uuid4

from app.config import settings
from app.store import AppStore
from app.logging_config import get_logger

logger = get_logger(__name__)


@dataclass
class JobState:
    job_id: str
    report_id: int
    status: str
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None
    error: str | None = None


class ReportJobManager:
    def __init__(self) -> None:
        self._pool = ThreadPoolExecutor(max_workers=max(1, settings.report_worker_count))
        self._lock = threading.Lock()
        self._jobs: dict[str, JobState] = {}
        self._futures: dict[str, Future[None]] = {}

    def submit(self, report_id: int, runner: Callable[[], None]) -> str:
        job_id = uuid4().hex
        state = JobState(
            job_id=job_id,
            report_id=report_id,
            status="queued",
            created_at=datetime.utcnow(),
        )
        with self._lock:
            self._jobs[job_id] = state

        def wrapped() -> None:
            with self._lock:
                current = self._jobs[job_id]
                current.status = "processing"
                current.started_at = datetime.utcnow()
            try:
                runner()
                with self._lock:
                    current = self._jobs[job_id]
                    current.status = "completed"
                    current.finished_at = datetime.utcnow()
            except Exception as exc:
                logger.exception("Report job failed: %s", exc)
                with self._lock:
                    current = self._jobs[job_id]
                    current.status = "failed"
                    current.error = str(exc)
                    current.finished_at = datetime.utcnow()

        fut = self._pool.submit(wrapped)
        with self._lock:
            self._futures[job_id] = fut
        return job_id

    def get(self, job_id: str) -> JobState | None:
        with self._lock:
            return self._jobs.get(job_id)

    def list(self) -> list[JobState]:
        with self._lock:
            return list(self._jobs.values())

    def recover_pending(self, store: AppStore, runner_factory: Callable[[int], Callable[[], None]]) -> int:
        recovered = 0
        for report in store.list_reports_desc():
            if report.status not in {"queued", "processing"}:
                continue
            self.submit(report.id, runner_factory(report.id))
            recovered += 1
        return recovered


job_manager = ReportJobManager()
