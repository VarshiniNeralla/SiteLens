from __future__ import annotations

import hashlib
import json
import os
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from tempfile import NamedTemporaryFile

from app.config import settings
from app.logging_config import get_logger
from app.schemas.upload import UploadResponse
from app.services import cloudinary_service, upload_service
from app.store import utcnow

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
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._base = Path(settings.data_dir) / "upload_sessions"
        self._base.mkdir(parents=True, exist_ok=True)
        self._meta_file = self._base / "sessions.json"
        self._sessions: dict[str, UploadSession] = {}
        self._load_unlocked()

    def _load_unlocked(self) -> None:
        if not self._meta_file.is_file():
            self._sessions = {}
            return
        raw = json.loads(self._meta_file.read_text(encoding="utf-8"))
        out: dict[str, UploadSession] = {}
        for sid, row in raw.items():
            out[sid] = UploadSession(**row)
        self._sessions = out

    def _persist_unlocked(self) -> None:
        payload = {sid: vars(sess) for sid, sess in self._sessions.items()}
        with NamedTemporaryFile(mode="w", encoding="utf-8", dir=str(self._base), delete=False) as tmp:
            tmp.write(json.dumps(payload, indent=2))
            tmp.flush()
            os.fsync(tmp.fileno())
            tmp_path = Path(tmp.name)
        os.replace(tmp_path, self._meta_file)

    def _part_path(self, session_id: str) -> Path:
        return self._base / f"{session_id}.part"

    def cleanup_expired(self) -> None:
        now = time.time()
        ttl = max(60, settings.upload_session_ttl_seconds)
        with self._lock:
            stale = [sid for sid, s in self._sessions.items() if now - s.updated_at_ts > ttl]
            for sid in stale:
                self._sessions.pop(sid, None)
                part = self._part_path(sid)
                if part.exists():
                    part.unlink(missing_ok=True)
            if stale:
                self._persist_unlocked()

    def create(self, *, filename: str, content_type: str, total_size: int, checksum_sha256: str | None) -> UploadSession:
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
        with self._lock:
            self._sessions[session.session_id] = session
            self._persist_unlocked()
        return session

    def get(self, session_id: str) -> UploadSession | None:
        with self._lock:
            return self._sessions.get(session_id)

    def list_sessions(self) -> list[UploadSession]:
        with self._lock:
            return list(self._sessions.values())

    def append_chunk(self, session_id: str, *, offset: int, payload: bytes) -> UploadSession:
        with self._lock:
            sess = self._sessions.get(session_id)
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
            self._sessions[session_id] = sess
            self._persist_unlocked()
            return sess

    def finalize(self, session_id: str) -> UploadResponse:
        with self._lock:
            sess = self._sessions.get(session_id)
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
            self._sessions[session_id] = sess
            self._persist_unlocked()
            part.unlink(missing_ok=True)
            return response


upload_sessions = UploadSessionStore()
