from __future__ import annotations

import asyncio
from datetime import date, datetime, timezone
from typing import Any, Awaitable, Callable

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import ASCENDING, DESCENDING, IndexModel, ReturnDocument
from pymongo.errors import AutoReconnect, ConnectionFailure, NetworkTimeout, ServerSelectionTimeoutError

from app.config import settings
from app.domain import ObservationRecord, ReportRecord
from app.logging_config import get_logger

logger = get_logger(__name__)

RetryableMongoError = (AutoReconnect, ConnectionFailure, NetworkTimeout, ServerSelectionTimeoutError)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _parse_datetime(raw: str | datetime | None) -> datetime | None:
    if raw is None:
        return None
    if isinstance(raw, datetime):
        if raw.tzinfo is None:
            return raw.replace(tzinfo=timezone.utc)
        return raw
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    dt = datetime.fromisoformat(raw)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _migration_ai_status(d: dict[str, Any]) -> str:
    raw = str(d.get("ai_status") or "").strip().lower()
    if raw in {"pending", "completed", "failed", "unavailable", "skipped"}:
        return raw
    if (d.get("generated_observation") or "").strip():
        return "completed"
    return "unavailable"


class AppStore:
    def __init__(self, db: AsyncIOMotorDatabase) -> None:
        self.db = db
        self.observations = db["observations"]
        self.reports = db["reports"]
        self.upload_sessions = db["upload_sessions"]
        self.jobs = db["jobs"]
        self.operations_logs = db["operations_logs"]
        self.users = db["users"]
        self.settings = db["settings"]
        self._degraded_reason: str | None = None

    async def _with_retry(self, op: Callable[[], Awaitable[Any]]) -> Any:
        attempts = max(1, settings.mongodb_retry_attempts)
        for idx in range(attempts):
            try:
                return await op()
            except RetryableMongoError as exc:
                self._degraded_reason = str(exc)
                if idx >= attempts - 1:
                    raise
                await asyncio.sleep(((idx + 1) * settings.mongodb_retry_backoff_ms) / 1000.0)

    async def ensure_indexes(self) -> None:
        await self._with_retry(
            lambda: self.observations.create_indexes(
                [
                    IndexModel([("id", ASCENDING)], unique=True, name="observation_id_idx"),
                    IndexModel([("project_id", ASCENDING)], name="project_id_idx"),
                    IndexModel([("created_at", DESCENDING)], name="observation_created_at_idx"),
                    IndexModel([("ai_status", ASCENDING)], name="observation_status_idx"),
                ]
            )
        )
        await self._with_retry(
            lambda: self.reports.create_indexes(
                [
                    IndexModel([("id", ASCENDING)], unique=True, name="report_id_idx"),
                    IndexModel([("created_at", DESCENDING)], name="report_created_at_idx"),
                    IndexModel([("status", ASCENDING)], name="report_status_idx"),
                ]
            )
        )
        await self._with_retry(
            lambda: self.upload_sessions.create_indexes(
                [
                    IndexModel([("session_id", ASCENDING)], unique=True, name="session_id_idx"),
                    IndexModel([("status", ASCENDING)], name="upload_session_status_idx"),
                    IndexModel([("updated_at_ts", DESCENDING)], name="upload_session_updated_at_idx"),
                ]
            )
        )
        await self._with_retry(
            lambda: self.jobs.create_indexes(
                [
                    IndexModel([("job_id", ASCENDING)], unique=True, name="job_id_idx"),
                    IndexModel([("report_id", ASCENDING)], name="job_report_id_idx"),
                    IndexModel([("status", ASCENDING)], name="job_status_idx"),
                    IndexModel([("created_at", DESCENDING)], name="job_created_at_idx"),
                ]
            )
        )
        await self._with_retry(
            lambda: self.operations_logs.create_indexes(
                [
                    IndexModel([("created_at", DESCENDING)], name="operations_log_created_at_idx"),
                    IndexModel([("status", ASCENDING)], name="operations_log_status_idx"),
                ]
            )
        )
        await self._with_retry(lambda: self.settings.create_indexes([IndexModel([("key", ASCENDING)], unique=True, name="settings_key_idx")]))

    async def mongo_health(self) -> dict[str, Any]:
        started = datetime.now(timezone.utc)
        try:
            await self._with_retry(lambda: self.db.command("ping"))
            latency_ms = (datetime.now(timezone.utc) - started).total_seconds() * 1000.0
            counts = {
                "observations": await self._with_retry(lambda: self.observations.count_documents({})),
                "reports": await self._with_retry(lambda: self.reports.count_documents({})),
                "upload_sessions": await self._with_retry(lambda: self.upload_sessions.count_documents({})),
                "jobs": await self._with_retry(lambda: self.jobs.count_documents({})),
                "operations_logs": await self._with_retry(lambda: self.operations_logs.count_documents({})),
            }
            self._degraded_reason = None
            return {"status": "connected", "latency_ms": round(latency_ms, 1), "counts": counts, "reason": None}
        except Exception as exc:  # noqa: BLE001
            self._degraded_reason = str(exc)
            return {
                "status": "degraded",
                "latency_ms": None,
                "counts": {},
                "reason": self._degraded_reason,
            }

    async def _next_seq(self, counter_name: str, minimum: int = 0) -> int:
        counter_key = f"counter:{counter_name}"
        base_value = max(0, int(minimum))
        # Initialize counter document (once) without conflicting operators.
        await self._with_retry(
            lambda: self.settings.update_one(
                {"key": counter_key},
                {"$setOnInsert": {"key": counter_key, "value": base_value}},
                upsert=True,
            )
        )
        doc = await self._with_retry(
            lambda: self.settings.find_one_and_update(
                {"key": counter_key},
                {"$inc": {"value": 1}},
                return_document=ReturnDocument.AFTER,
            )
        )
        return int(doc["value"])

    async def project_id_for_name(self, name: str) -> int:
        key = name.strip()
        if not key:
            raise ValueError("Project name cannot be empty")
        existing = await self._with_retry(lambda: self.settings.find_one({"key": f"project:{key}"}))
        if existing is not None:
            return int(existing["project_id"])
        project_id = await self._next_seq("project", 0)
        await self._with_retry(
            lambda: self.settings.update_one(
                {"key": f"project:{key}"},
                {"$setOnInsert": {"key": f"project:{key}", "project_name": key, "project_id": project_id}},
                upsert=True,
            )
        )
        final = await self._with_retry(lambda: self.settings.find_one({"key": f"project:{key}"}))
        return int(final["project_id"])

    async def allocate_observation_id(self) -> int:
        return await self._next_seq("observation", 0)

    async def allocate_report_id(self) -> int:
        return await self._next_seq("report", 0)

    @staticmethod
    def _obs_doc(o: ObservationRecord) -> dict[str, Any]:
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
            "created_at": o.created_at,
            "cloudinary_public_id": o.cloudinary_public_id,
            "cloudinary_secure_url": o.cloudinary_secure_url,
            "image_uploaded_at": o.image_uploaded_at,
            "image_original_filename": o.image_original_filename,
            "manually_written_observation": o.manually_written_observation,
            "ai_status": o.ai_status,
            "ai_error": o.ai_error,
        }

    @staticmethod
    def _obs_row(d: dict[str, Any]) -> ObservationRecord:
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
            slab_casting_date=date.fromisoformat(str(d["slab_casting_date"])) if d.get("slab_casting_date") else None,
            inspection_status=str(d.get("inspection_status", "")),
            third_party_status=str(d.get("third_party_status", "")),
            image_path=str(d["image_path"]),
            generated_observation=str(d.get("generated_observation", "")),
            generated_recommendation=str(d.get("generated_recommendation", "")),
            created_at=_parse_datetime(d.get("created_at")) or utcnow(),
            cloudinary_public_id=(str(d["cloudinary_public_id"]) if d.get("cloudinary_public_id") else None),
            cloudinary_secure_url=(str(d["cloudinary_secure_url"]) if d.get("cloudinary_secure_url") else None),
            image_uploaded_at=_parse_datetime(d.get("image_uploaded_at")),
            image_original_filename=(str(d["image_original_filename"]) if d.get("image_original_filename") else None),
            manually_written_observation=str(d.get("manually_written_observation") or ""),
            ai_status=_migration_ai_status(d),
            ai_error=(str(d["ai_error"]) if d.get("ai_error") else None),
        )

    @staticmethod
    def _report_doc(r: ReportRecord) -> dict[str, Any]:
        return {
            "id": r.id,
            "project_id": r.project_id,
            "title": r.title,
            "status": r.status,
            "pptx_path": r.pptx_path,
            "pdf_path": r.pdf_path,
            "xlsx_path": r.xlsx_path,
            "summary": r.summary,
            "error_message": r.error_message,
            "created_at": r.created_at,
            "observation_ids": list(r.observation_ids),
            "include_pdf": bool(r.include_pdf),
        }

    @staticmethod
    def _report_row(d: dict[str, Any]) -> ReportRecord:
        return ReportRecord(
            id=int(d["id"]),
            project_id=int(d["project_id"]),
            title=str(d["title"]),
            status=str(d["status"]),
            pptx_path=d.get("pptx_path"),
            pdf_path=d.get("pdf_path"),
            xlsx_path=d.get("xlsx_path"),
            summary=d.get("summary"),
            error_message=d.get("error_message"),
            created_at=_parse_datetime(d.get("created_at")) or utcnow(),
            observation_ids=[int(x) for x in d.get("observation_ids", [])],
            include_pdf=bool(d.get("include_pdf", True)),
        )

    async def add_observation(self, obs: ObservationRecord) -> ObservationRecord:
        await self._with_retry(lambda: self.observations.update_one({"id": obs.id}, {"$set": self._obs_doc(obs)}, upsert=True))
        return obs

    async def list_observations(self, project_id: int | None = None, *, limit: int = 500, skip: int = 0) -> list[ObservationRecord]:
        query: dict[str, Any] = {}
        if project_id is not None:
            query["project_id"] = project_id
        cursor = self.observations.find(query).sort("id", DESCENDING).skip(max(0, skip)).limit(max(1, limit))
        rows: list[ObservationRecord] = []
        async for d in cursor:
            rows.append(self._obs_row(d))
        return rows

    async def get_observation(self, oid: int) -> ObservationRecord | None:
        row = await self._with_retry(lambda: self.observations.find_one({"id": oid}))
        return self._obs_row(row) if row else None

    async def replace_observation(self, obs: ObservationRecord) -> None:
        await self._with_retry(lambda: self.observations.update_one({"id": obs.id}, {"$set": self._obs_doc(obs)}, upsert=True))

    async def delete_observation(self, oid: int) -> ObservationRecord | None:
        row = await self.get_observation(oid)
        if row is None:
            return None
        await self._with_retry(lambda: self.observations.delete_one({"id": oid}))
        return row

    async def upsert_report(self, r: ReportRecord) -> ReportRecord:
        await self._with_retry(lambda: self.reports.update_one({"id": r.id}, {"$set": self._report_doc(r)}, upsert=True))
        return r

    async def get_report(self, rid: int) -> ReportRecord | None:
        row = await self._with_retry(lambda: self.reports.find_one({"id": rid}))
        return self._report_row(row) if row else None

    async def list_reports_desc(self, *, limit: int = 500, skip: int = 0) -> list[ReportRecord]:
        cursor = self.reports.find({}).sort("id", DESCENDING).skip(max(0, skip)).limit(max(1, limit))
        out: list[ReportRecord] = []
        async for row in cursor:
            out.append(self._report_row(row))
        return out

    async def delete_report(self, rid: int) -> ReportRecord | None:
        row = await self.get_report(rid)
        if row is None:
            return None
        await self._with_retry(lambda: self.reports.delete_one({"id": rid}))
        return row


class MongoConnectionManager:
    def __init__(self) -> None:
        self.client: AsyncIOMotorClient | None = None
        self.db: AsyncIOMotorDatabase | None = None

    async def connect(self) -> AppStore:
        self.client = AsyncIOMotorClient(
            settings.mongodb_url,
            connectTimeoutMS=settings.mongodb_connect_timeout_ms,
            serverSelectionTimeoutMS=settings.mongodb_server_selection_timeout_ms,
            retryWrites=True,
            appname="sitelens-backend",
        )
        self.db = self.client[settings.mongodb_db]
        store = AppStore(self.db)
        try:
            await self.db.command("ping")
            await store.ensure_indexes()
            logger.info("MongoDB ready db=%s", settings.mongodb_db)
        except Exception as exc:  # noqa: BLE001
            logger.warning("MongoDB startup degraded: %s", exc)
        return store

    async def close(self) -> None:
        if self.client is not None:
            self.client.close()
            logger.info("MongoDB connection closed")
            self.client = None
            self.db = None
