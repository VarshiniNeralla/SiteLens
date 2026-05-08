import asyncio
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile

from app.schemas.upload import UploadResponse
from app.services import cloudinary_service, upload_service
from app.store import utcnow

router = APIRouter(prefix="/upload", tags=["upload"])


@router.post("", response_model=UploadResponse)
async def upload_image(file: UploadFile = File(...)) -> UploadResponse:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")
    data = await file.read()
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
        except RuntimeError as e:
            raise HTTPException(status_code=503, detail=str(e)) from e
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
