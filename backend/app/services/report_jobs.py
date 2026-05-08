from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime
from typing import Awaitable, Callable
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
        import threading

        self._semaphore = asyncio.Semaphore(max(1, settings.report_worker_count))
        self._lock = threading.Lock()
        self._jobs: dict[str, JobState] = {}

    async def submit(self, report_id: int, runner: Callable[[], Awaitable[None]], store: AppStore | None = None) -> str:
        job_id = uuid4().hex
        state = JobState(
            job_id=job_id,
            report_id=report_id,
            status="queued",
            created_at=datetime.utcnow(),
        )
        with self._lock:
            self._jobs[job_id] = state

        async def wrapped() -> None:
            await self._semaphore.acquire()
            with self._lock:
                current = self._jobs[job_id]
                current.status = "processing"
                current.started_at = datetime.utcnow()
            if store is not None:
                await store.jobs.update_one(
                    {"job_id": job_id},
                    {"$set": vars(current)},
                    upsert=True,
                )
            try:
                await runner()
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
            finally:
                if store is not None:
                    await store.jobs.update_one({"job_id": job_id}, {"$set": vars(self._jobs[job_id])}, upsert=True)
                self._semaphore.release()

        if store is not None:
            await store.jobs.update_one({"job_id": job_id}, {"$set": vars(state)}, upsert=True)
        asyncio.create_task(wrapped())
        return job_id

    def get(self, job_id: str) -> JobState | None:
        with self._lock:
            return self._jobs.get(job_id)

    def list(self) -> list[JobState]:
        with self._lock:
            return list(self._jobs.values())

    async def recover_pending(self, store: AppStore, runner_factory: Callable[[int], Callable[[], Awaitable[None]]]) -> int:
        recovered = 0
        for report in await store.list_reports_desc(limit=2000):
            if report.status not in {"queued", "processing"}:
                continue
            await self.submit(report.id, runner_factory(report.id), store=store)
            recovered += 1
        return recovered


job_manager = ReportJobManager()
