import asyncio
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Request, UploadFile

from app.config import settings
from app.schemas.upload import (
    UploadResponse,
    UploadSessionCreateRequest,
    UploadSessionOut,
)
from app.services import cloudinary_service, upload_service
from app.services.upload_sessions import UploadSessionStore
from app.store import utcnow

router = APIRouter(prefix="/upload", tags=["upload"])


@router.post("/sessions", response_model=UploadSessionOut, status_code=201)
async def create_upload_session(payload: UploadSessionCreateRequest, request: Request) -> UploadSessionOut:
    sessions: UploadSessionStore = request.app.state.upload_sessions
    await sessions.cleanup_expired()
    if payload.total_size > settings.upload_max_bytes:
        raise HTTPException(status_code=413, detail=f"Upload exceeds {settings.upload_max_bytes} bytes")
    session = await sessions.create(
        filename=Path(payload.filename).name,
        content_type=payload.content_type,
        total_size=payload.total_size,
        checksum_sha256=payload.checksum_sha256,
    )
    return UploadSessionOut(
        session_id=session.session_id,
        total_size=session.total_size,
        uploaded_bytes=session.uploaded_bytes,
        chunk_size=settings.resumable_chunk_size,
        status=session.status,
    )


@router.get("/sessions/{session_id}", response_model=UploadSessionOut)
async def get_upload_session(session_id: str, request: Request) -> UploadSessionOut:
    sessions: UploadSessionStore = request.app.state.upload_sessions
    await sessions.cleanup_expired()
    session = await sessions.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Upload session not found")
    return UploadSessionOut(
        session_id=session.session_id,
        total_size=session.total_size,
        uploaded_bytes=session.uploaded_bytes,
        chunk_size=settings.resumable_chunk_size,
        status=session.status,
    )


@router.put("/sessions/{session_id}/chunk", response_model=UploadSessionOut)
async def append_upload_chunk(session_id: str, request: Request) -> UploadSessionOut:
    sessions: UploadSessionStore = request.app.state.upload_sessions
    await sessions.cleanup_expired()
    offset_raw = request.headers.get("X-Chunk-Offset", "")
    try:
        offset = int(offset_raw)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="Missing/invalid X-Chunk-Offset") from e
    payload = await request.body()
    if not payload:
        raise HTTPException(status_code=400, detail="Empty chunk")
    try:
        session = await sessions.append_chunk(session_id, offset=offset, payload=payload)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    return UploadSessionOut(
        session_id=session.session_id,
        total_size=session.total_size,
        uploaded_bytes=session.uploaded_bytes,
        chunk_size=settings.resumable_chunk_size,
        status=session.status,
    )


@router.post("/sessions/{session_id}/complete", response_model=UploadResponse)
async def complete_upload_session(session_id: str, request: Request) -> UploadResponse:
    sessions: UploadSessionStore = request.app.state.upload_sessions
    await sessions.cleanup_expired()
    try:
        return await sessions.finalize(session_id)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e


@router.post("", response_model=UploadResponse)
async def upload_image(file: UploadFile = File(...)) -> UploadResponse:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")
    data_parts: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(settings.upload_chunk_bytes)
        if not chunk:
            break
        total += len(chunk)
        if total > settings.upload_max_bytes:
            raise HTTPException(status_code=413, detail=f"Upload exceeds {settings.upload_max_bytes} bytes")
        data_parts.append(chunk)
    data = b"".join(data_parts)
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")

    ctype = file.content_type or "application/octet-stream"

    if cloudinary_service.cloudinary_enabled():
        try:
            result = await asyncio.to_thread(
                cloudinary_service.upload_image_bytes,
                data,
                file.filename or "image.jpg",
            )
            uploaded = utcnow()
            optimized = result["optimized_url"]
            fname = Path(file.filename or "image").name
            return UploadResponse(
                path=optimized,
                filename=fname,
                content_type=ctype if ctype != "application/octet-stream" else "image/jpeg",
                public_id=result["public_id"],
                secure_url=result["secure_url"],
                optimized_url=optimized,
                uploaded_at=uploaded,
            )
        except RuntimeError:
            # Fallback to local disk so core workflow survives dependency outage.
            pass

    try:
        path, stored = upload_service.store_upload(file.filename, data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    resolved = Path(path)
    if not resolved.is_absolute():
        resolved = Path.cwd() / resolved
    if not resolved.is_file():
        raise HTTPException(status_code=500, detail="Upload failed to persist to disk")

    return UploadResponse(
        path=path,
        filename=stored,
        content_type=ctype,
        uploaded_at=utcnow(),
    )
