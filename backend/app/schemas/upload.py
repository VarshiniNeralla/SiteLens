from datetime import datetime

from pydantic import BaseModel, Field


class UploadResponse(BaseModel):
    """Cloudinary (primary) or legacy disk upload."""

    path: str = Field(..., description="Use as observation image_path (optimized URL or relative disk path)")
    filename: str = Field(..., description="Original filename or stored basename")
    content_type: str

    public_id: str = Field(default="", description="Cloudinary public_id when applicable")
    secure_url: str = Field(default="", description="Raw secure delivery URL")
    optimized_url: str = Field(default="", description="f_auto,q_auto secure URL (same as path when using Cloudinary)")
    uploaded_at: datetime | None = Field(default=None, description="Upload completion time (UTC)")


class UploadSessionCreateRequest(BaseModel):
    filename: str = Field(..., min_length=1, max_length=512)
    content_type: str = Field(default="application/octet-stream", max_length=128)
    total_size: int = Field(..., gt=0)
    checksum_sha256: str | None = Field(default=None, max_length=128)


class UploadSessionOut(BaseModel):
    session_id: str
    total_size: int
    uploaded_bytes: int
    chunk_size: int
    status: str
