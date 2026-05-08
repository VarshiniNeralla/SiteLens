"""In-memory domain types (no database ORM)."""

from dataclasses import dataclass
from datetime import date, datetime


@dataclass
class ObservationRecord:
    id: int
    project_id: int
    project_name: str
    tower: str
    floor: str
    flat: str
    room: str
    observation_type: str
    severity: str
    site_visit_date: date | None
    slab_casting_date: date | None
    inspection_status: str
    third_party_status: str
    image_path: str
    generated_observation: str
    generated_recommendation: str
    created_at: datetime
    cloudinary_public_id: str | None = None
    cloudinary_secure_url: str | None = None
    image_uploaded_at: datetime | None = None
    image_original_filename: str | None = None
    manually_written_observation: str = ""
    ai_status: str = "unavailable"
    ai_error: str | None = None


@dataclass
class ReportRecord:
    id: int
    project_id: int
    title: str
    status: str
    pptx_path: str | None
    pdf_path: str | None
    xlsx_path: str | None
    summary: str | None
    error_message: str | None
    created_at: datetime
    observation_ids: list[int]
    include_pdf: bool = True
