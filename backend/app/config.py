from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # OpenAI-compatible root: POST goes to {llm_base_url}/chat/completions unless llm_chat_url is set
    llm_base_url: str = "http://172.20.7.22:8000/v1"

    llm_chat_url: str | None = None  # Env: LLM_CHAT_URL — full URL override for non-standard paths

    llm_model: str = "default"
    llm_timeout_seconds: float = 120.0

    upload_dir: Path = Path("uploads")
    reports_dir: Path = Path("reports")
    data_dir: Path = Path("data")

    ppt_layout_path: Path = Path("data/ppt_layout.json")
    ppt_template_path: Path | None = None
    libreoffice_soffice: str = "soffice"

    image_max_dimension: int = 2048
    image_jpeg_quality: int = 85

    api_prefix: str = ""
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # Cloudinary — when cloud_name + key + secret set, uploads go to CDN (otherwise local disk).
    cloudinary_cloud_name: str = ""
    cloudinary_api_key: str = ""
    cloudinary_api_secret: str = ""
    cloudinary_folder: str = "SiteLens"

    @field_validator("ppt_template_path", mode="before")
    @classmethod
    def coerce_optional_template(cls, v: Path | str | None) -> Path | None:
        if v is None or v == "":
            return None
        return Path(v) if isinstance(v, str) else v

    @field_validator("llm_chat_url", mode="before")
    @classmethod
    def coerce_optional_llm_url(cls, v: str | None) -> str | None:
        if v is None or (isinstance(v, str) and not v.strip()):
            return None
        return str(v).strip() if isinstance(v, str) else v

    @field_validator("upload_dir", "reports_dir", "data_dir", "ppt_layout_path", mode="before")
    @classmethod
    def coerce_path(cls, v: Path | str | None) -> Path | None:
        if v is None or v == "":
            return None
        return Path(v) if isinstance(v, str) else v

    def cors_origins_list(self) -> list[str]:
        return [x.strip() for x in self.cors_origins.split(",") if x.strip()]


settings = Settings()


def llm_chat_completions_url() -> str:
    if settings.llm_chat_url:
        return settings.llm_chat_url
    return str(settings.llm_base_url).rstrip("/") + "/chat/completions"
