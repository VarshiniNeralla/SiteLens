from pydantic import BaseModel, Field


class UploadResponse(BaseModel):
    filename: str = Field(..., description="Stored filename relative to uploads root")
    path: str = Field(..., description="Relative path usable as image_path in observations")
    content_type: str
