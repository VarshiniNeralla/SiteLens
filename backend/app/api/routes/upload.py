from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile

from app.schemas.upload import UploadResponse
from app.services import upload_service

router = APIRouter(prefix="/upload", tags=["upload"])


@router.post("", response_model=UploadResponse)
async def upload_image(file: UploadFile = File(...)) -> UploadResponse:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
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
        filename=stored,
        path=path,
        content_type=file.content_type or "application/octet-stream",
    )
