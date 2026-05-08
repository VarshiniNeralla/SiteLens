"""Cloudinary uploads with retries and optimized delivery URLs."""

from __future__ import annotations

import time
from io import BytesIO
from typing import Any

import cloudinary
import cloudinary.api
import cloudinary.uploader
from cloudinary.utils import cloudinary_url

from app.config import settings
from app.services.fault_injection import faults
from app.logging_config import get_logger
from app.services.circuit_breaker import get_breaker

logger = get_logger(__name__)
_BREAKER = get_breaker("cloudinary")

_MAX_UPLOAD_RETRIES = 3
_RETRY_BASE_SECONDS = 0.45


def cloudinary_enabled() -> bool:
    return bool(settings.cloudinary_cloud_name and settings.cloudinary_api_key and settings.cloudinary_api_secret)


def _ensure_configured() -> None:
    cloudinary.config(
        cloud_name=settings.cloudinary_cloud_name,
        api_key=settings.cloudinary_api_key,
        api_secret=settings.cloudinary_api_secret,
        secure=True,
    )


def startup_health() -> dict[str, Any]:
    """Best-effort startup check used for explicit boot logs."""
    if not cloudinary_enabled():
        return {
            "status": "disabled",
            "reason": "Cloudinary env vars are not fully configured",
            "cloud_name": settings.cloudinary_cloud_name or None,
            "folder": settings.cloudinary_folder or "SiteLens",
        }
    try:
        _ensure_configured()
        # Lightweight auth/config validation at startup.
        cloudinary.api.ping()
        return {
            "status": "connected",
            "reason": None,
            "cloud_name": settings.cloudinary_cloud_name,
            "folder": settings.cloudinary_folder or "SiteLens",
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "status": "degraded",
            "reason": str(exc),
            "cloud_name": settings.cloudinary_cloud_name or None,
            "folder": settings.cloudinary_folder or "SiteLens",
        }


def build_optimized_url(public_id: str) -> str:
    """Auto format/quality, HTTPS delivery."""
    _ensure_configured()
    url, _ = cloudinary_url(
        public_id,
        secure=True,
        fetch_format="auto",
        quality="auto",
    )
    return str(url)


def build_excel_thumb_url(public_id: str) -> str:
    """Bounded size for embedding in spreadsheets."""
    _ensure_configured()
    url, _ = cloudinary_url(
        public_id,
        secure=True,
        fetch_format="auto",
        quality="auto",
        width=280,
        height=210,
        crop="limit",
    )
    return str(url)


def upload_image_bytes(file_bytes: bytes, original_filename: str) -> dict[str, Any]:
    """
    Upload to folder CLOUDINARY_FOLDER with retries.
    Returns dict with public_id, secure_url, optimized_url, width, height, ...
    """
    if not cloudinary_enabled():
        raise RuntimeError("Cloudinary is not configured (set CLOUDINARY_* env vars).")
    if not _BREAKER.allow():
        raise RuntimeError("Cloudinary temporarily unavailable (circuit open)")
    mode = faults.apply("cloudinary")
    if mode == "outage":
        _BREAKER.record_failure()
        raise RuntimeError("Injected Cloudinary outage")

    _ensure_configured()

    folder = (settings.cloudinary_folder or "SiteLens").strip() or "SiteLens"
    last_err: BaseException | None = None

    for attempt in range(1, _MAX_UPLOAD_RETRIES + 1):
        started = time.perf_counter()
        try:
            bio = BytesIO(file_bytes)
            bio.seek(0)
            result = cloudinary.uploader.upload(
                bio,
                folder=folder,
                resource_type="image",
                overwrite=False,
                unique_filename=True,
                use_filename=False,
                original_filename=original_filename or None,
            )
            public_id = str(result.get("public_id") or "").strip()
            secure_url = str(result.get("secure_url") or result.get("url") or "").strip()
            if not public_id or not secure_url:
                raise RuntimeError("Cloudinary response missing public_id or secure_url")

            optimized = build_optimized_url(public_id)
            logger.info("Cloudinary upload OK public_id=%s attempt=%s", public_id, attempt)
            elapsed_ms = (time.perf_counter() - started) * 1000.0
            _BREAKER.record_success(latency_ms=elapsed_ms, retries=attempt - 1)
            return {
                "public_id": public_id,
                "secure_url": secure_url,
                "optimized_url": optimized,
                "width": result.get("width"),
                "height": result.get("height"),
                "bytes": result.get("bytes"),
            }
        except BaseException as e:  # noqa: BLE001 — Cloudinary/network surface
            last_err = e
            elapsed_ms = (time.perf_counter() - started) * 1000.0
            _BREAKER.record_failure(latency_ms=elapsed_ms, retries=max(0, attempt - 1))
            logger.warning("Cloudinary upload attempt %s failed: %s", attempt, e)
            if attempt < _MAX_UPLOAD_RETRIES:
                time.sleep(_RETRY_BASE_SECONDS * (2 ** (attempt - 1)))

    raise RuntimeError(f"Cloudinary upload failed after {_MAX_UPLOAD_RETRIES} attempts: {last_err}") from last_err
