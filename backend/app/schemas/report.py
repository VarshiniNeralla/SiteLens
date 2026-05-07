from datetime import datetime

from pydantic import BaseModel, Field, ConfigDict


class ReportGenerateRequest(BaseModel):
    observation_ids: list[int] = Field(..., min_length=1)
    title: str | None = None
    include_pdf: bool = True


class ReportOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    title: str
    status: str
    pptx_path: str | None
    pdf_path: str | None
    summary: str | None
    error_message: str | None
    created_at: datetime
    observation_ids: list[int]


class ReportSummaryOut(BaseModel):
    """List view."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    title: str
    status: str
    created_at: datetime
    has_pptx: bool = False
    has_pdf: bool = False
    primary_project_name: str | None = None
