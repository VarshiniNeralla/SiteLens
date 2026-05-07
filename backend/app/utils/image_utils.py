from io import BytesIO
from pathlib import Path

from PIL import Image


def validate_image_content(data: bytes) -> None:
    try:
        with Image.open(BytesIO(data)) as img:
            img.verify()
    except Exception as e:  # noqa: BLE001
        raise ValueError("Invalid image file") from e


def compress_save_image(
    data: bytes,
    dest_path: Path,
    *,
    max_dim: int,
    jpeg_quality: int,
) -> Path:
    """Write image to disk after optional downscale. PNG/WEBP preserved; JPEG used otherwise."""
    suffix = dest_path.suffix.lower()
    if suffix in (".png",):
        out_path = dest_path.with_suffix(".png")
        fmt = "PNG"
    elif suffix in (".webp",):
        out_path = dest_path.with_suffix(".webp")
        fmt = "WEBP"
    else:
        out_path = dest_path.with_suffix(".jpg")
        fmt = "JPEG"

    with Image.open(BytesIO(data)) as img:
        img.load()
        if img.mode == "RGBA":
            background = Image.new("RGB", img.size, (255, 255, 255))
            background.paste(img, mask=img.split()[3])
            img = background
        elif img.mode != "RGB":
            img = img.convert("RGB")

        img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)

        if fmt == "PNG":
            img.save(out_path, format="PNG", optimize=True)
        elif fmt == "WEBP":
            img.save(out_path, format="WEBP", quality=jpeg_quality)
        else:
            img.save(out_path, format="JPEG", quality=jpeg_quality, optimize=True)

    return out_path


ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
