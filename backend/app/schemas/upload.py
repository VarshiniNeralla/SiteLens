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
