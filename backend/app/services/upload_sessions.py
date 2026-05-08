from __future__ import annotations

import hashlib
import os
import time
from dataclasses import dataclass
from pathlib import Path

from app.config import settings
from app.logging_config import get_logger
from app.schemas.upload import UploadResponse
from app.services import cloudinary_service, upload_service
from app.store import AppStore, utcnow

logger = get_logger(__name__)


@dataclass
class UploadSession:
    session_id: str
    filename: str
    content_type: str
    total_size: int
    uploaded_bytes: int
    checksum_sha256: str | None
    created_at_ts: float
    updated_at_ts: float
    status: str  # active | completed | failed
    final_response: dict | None


class UploadSessionStore:
    def __init__(self, store: AppStore) -> None:
        self.store = store
        self._base = Path(settings.data_dir) / "upload_sessions"
        self._base.mkdir(parents=True, exist_ok=True)

    def _part_path(self, session_id: str) -> Path:
        return self._base / f"{session_id}.part"

    async def cleanup_expired(self) -> None:
        now = time.time()
        ttl = max(60, settings.upload_session_ttl_seconds)
        cursor = self.store.upload_sessions.find({"updated_at_ts": {"$lt": now - ttl}})
        stale_ids: list[str] = []
        async for row in cursor:
            stale_ids.append(str(row["session_id"]))
        for sid in stale_ids:
            part = self._part_path(sid)
            if part.exists():
                part.unlink(missing_ok=True)
        if stale_ids:
            await self.store.upload_sessions.delete_many({"session_id": {"$in": stale_ids}})

    async def create(self, *, filename: str, content_type: str, total_size: int, checksum_sha256: str | None) -> UploadSession:
        import uuid
        now = time.time()
        session = UploadSession(
            session_id=uuid.uuid4().hex,
            filename=filename,
            content_type=content_type,
            total_size=total_size,
            uploaded_bytes=0,
            checksum_sha256=checksum_sha256,
            created_at_ts=now,
            updated_at_ts=now,
            status="active",
            final_response=None,
        )
        await self.store.upload_sessions.update_one({"session_id": session.session_id}, {"$set": vars(session)}, upsert=True)
        return session

    async def get(self, session_id: str) -> UploadSession | None:
        row = await self.store.upload_sessions.find_one({"session_id": session_id})
        if not row:
            return None
        row.pop("_id", None)
        return UploadSession(**row)

    async def list_sessions(self) -> list[UploadSession]:
        out: list[UploadSession] = []
        async for row in self.store.upload_sessions.find({}).sort("updated_at_ts", -1).limit(1000):
            row.pop("_id", None)
            out.append(UploadSession(**row))
        return out

    async def append_chunk(self, session_id: str, *, offset: int, payload: bytes) -> UploadSession:
        sess = await self.get(session_id)
        if sess is None:
            raise ValueError("Upload session not found")
        if sess.status != "active":
            return sess
        if offset != sess.uploaded_bytes:
            raise ValueError(f"Offset mismatch. Expected {sess.uploaded_bytes}, got {offset}")
        if sess.uploaded_bytes + len(payload) > sess.total_size:
            raise ValueError("Chunk exceeds declared file size")
        part = self._part_path(session_id)
        with open(part, "ab") as f:
            f.write(payload)
            f.flush()
            os.fsync(f.fileno())
        sess.uploaded_bytes += len(payload)
        sess.updated_at_ts = time.time()
        await self.store.upload_sessions.update_one({"session_id": session_id}, {"$set": vars(sess)}, upsert=True)
        return sess

    async def finalize(self, session_id: str) -> UploadResponse:
        sess = await self.get(session_id)
        if sess is None:
            raise ValueError("Upload session not found")
        if sess.final_response is not None:
            return UploadResponse(**sess.final_response)
        if sess.uploaded_bytes != sess.total_size:
            raise ValueError("Upload is incomplete")
        part = self._part_path(session_id)
        if not part.is_file():
            raise ValueError("Upload chunk file missing")
        data = part.read_bytes()
        if sess.checksum_sha256:
            digest = hashlib.sha256(data).hexdigest()
            if digest.lower() != sess.checksum_sha256.lower():
                raise ValueError("Checksum mismatch")
        if cloudinary_service.cloudinary_enabled():
            try:
                result = cloudinary_service.upload_image_bytes(data, sess.filename)
                response = UploadResponse(
                    path=result["optimized_url"],
                    filename=sess.filename,
                    content_type=sess.content_type,
                    public_id=result["public_id"],
                    secure_url=result["secure_url"],
                    optimized_url=result["optimized_url"],
                    uploaded_at=utcnow(),
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("Cloudinary failed during resumable finalize; falling back to local store: %s", exc)
                path, stored = upload_service.store_upload(sess.filename, data)
                response = UploadResponse(
                    path=path,
                    filename=stored,
                    content_type=sess.content_type or "application/octet-stream",
                    uploaded_at=utcnow(),
                )
        else:
            path, stored = upload_service.store_upload(sess.filename, data)
            response = UploadResponse(
                path=path,
                filename=stored,
                content_type=sess.content_type or "application/octet-stream",
                uploaded_at=utcnow(),
            )
        sess.status = "completed"
        sess.final_response = response.model_dump(mode="json")
        sess.updated_at_ts = time.time()
        await self.store.upload_sessions.update_one({"session_id": session_id}, {"$set": vars(sess)}, upsert=True)
        part.unlink(missing_ok=True)
        return response
