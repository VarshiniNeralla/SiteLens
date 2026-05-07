import os
import shutil
import subprocess
from pathlib import Path

from app.config import settings
from app.logging_config import get_logger

logger = get_logger(__name__)


def _resolve_soffice_binary() -> str:
    """Resolve soffice binary from config/PATH/common Windows installs."""
    configured = (settings.libreoffice_soffice or "").strip()
    if configured:
        p = Path(configured)
        if p.is_file():
            return str(p)
        found = shutil.which(configured)
        if found:
            return found

    if os.name == "nt":
        candidates = [
            Path("C:/Program Files/LibreOffice/program/soffice.exe"),
            Path("C:/Program Files (x86)/LibreOffice/program/soffice.exe"),
        ]
        for c in candidates:
            if c.is_file():
                return str(c)

    raise FileNotFoundError(
        "LibreOffice executable not found. Set LIBREOFFICE_SOFFICE to the full path "
        "(e.g. C:/Program Files/LibreOffice/program/soffice.exe) or add soffice to PATH."
    )


def pptx_to_pdf(pptx_path: Path, out_dir: Path) -> Path:
    """Convert PPTX to PDF using LibreOffice headless. Returns destination PDF path."""
    out_dir.mkdir(parents=True, exist_ok=True)
    pptx_path = pptx_path.resolve()
    soffice_bin = _resolve_soffice_binary()
    proc = subprocess.run(
        [
            soffice_bin,
            "--headless",
            "--norestore",
            "--nolockcheck",
            "--nodefault",
            "--nofirststartwizard",
            f"-env:UserInstallation=file:///{out_dir.as_posix()}/lo-profile",
            "--convert-to",
            "pdf",
            "--outdir",
            str(out_dir.resolve()),
            str(pptx_path),
        ],
        capture_output=True,
        text=True,
        timeout=600,
        check=False,
    )
    if proc.returncode != 0:
        logger.error(
            "LibreOffice failed (code %s): stderr=%s stdout=%s",
            proc.returncode,
            proc.stderr,
            proc.stdout,
        )
        raise RuntimeError("PDF conversion failed — check LibreOffice installation and LIBREOFFICE_SOFFICE path")

    pdf_path = out_dir / (pptx_path.stem + ".pdf")
    if not pdf_path.is_file():
        raise RuntimeError("PDF conversion produced no output file")
    return pdf_path
