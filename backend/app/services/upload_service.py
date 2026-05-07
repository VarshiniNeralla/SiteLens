import uuid
from pathlib import Path

from app.config import settings
from app.utils.image_utils import (
    ALLOWED_EXTENSIONS,
    compress_save_image,
    validate_image_content,
)


def store_upload(filename: str, data: bytes) -> tuple[str, str]:
    """
    Persist an upload under uploads/. Returns:
    - posix relative path usable as image_path in observations (e.g. uploads/<file>)
    - stored filename basename
    """
    suffix = Path(filename).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise ValueError(
            f"Unsupported file type {suffix!r}. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
        )
    validate_image_content(data)

    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    base_name = f"{uuid.uuid4().hex}{suffix}"
    dest = settings.upload_dir / base_name

    final_path = compress_save_image(
        data,
        dest,
        max_dim=settings.image_max_dimension,
        jpeg_quality=settings.image_jpeg_quality,
    )

    cwd = Path.cwd().resolve()
    abs_final = final_path.resolve()
    try:
        rel = abs_final.relative_to(cwd)
    except ValueError:
        rel = Path(settings.upload_dir.name) / abs_final.name

    rel_posix = rel.as_posix()
    return rel_posix, abs_final.name
