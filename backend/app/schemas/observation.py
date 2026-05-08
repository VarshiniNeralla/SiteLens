from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class ObservationCreate(BaseModel):
    project_name: str = Field(..., min_length=1, max_length=512)
    tower: str = ""
    floor: str = ""
    flat: str = ""
    room: str = ""
    observation_type: str = ""
    severity: str = ""
    site_visit_date: date | None = None
    slab_casting_date: date | None = None
    inspection_status: str = ""
    third_party_status: str = ""
    image_path: str = Field(..., min_length=1)
    cloudinary_public_id: str | None = None
    cloudinary_secure_url: str | None = None
    image_uploaded_at: datetime | None = None
    image_original_filename: str | None = None
    manually_written_observation: str = ""
    generate_text: bool = True


class ObservationUpdate(BaseModel):
    tower: str | None = None
    floor: str | None = None
    flat: str | None = None
    room: str | None = None
    observation_type: str | None = None
    severity: str | None = None
    site_visit_date: date | None = None
    slab_casting_date: date | None = None
    inspection_status: str | None = None
    third_party_status: str | None = None
    image_path: str | None = None
    cloudinary_public_id: str | None = None
    cloudinary_secure_url: str | None = None
    image_uploaded_at: datetime | None = None
    image_original_filename: str | None = None
    manually_written_observation: str | None = None
    regenerate_text: bool = False


class ObservationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
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
    manually_written_observation: str = ""
    ai_status: str = "unavailable"
    ai_error: str | None = None
    cloudinary_public_id: str | None = None
    cloudinary_secure_url: str | None = None
    image_uploaded_at: datetime | None = None
    image_original_filename: str | None = None
    notice: str | None = Field(
        default=None,
        description="Human-readable status for UX (no raw infra errors)",
    )
