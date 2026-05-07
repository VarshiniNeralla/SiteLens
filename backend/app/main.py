from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.routes import observations, reports, upload
from app.config import settings
from app.logging_config import get_logger, setup_logging
from app.store import get_store

setup_logging()
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ARG001
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    settings.reports_dir.mkdir(parents=True, exist_ok=True)
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    _ = get_store()
    logger.info("JSON datastore ready")
    yield


app = FastAPI(
    title="Quality Walkthrough Report API",
    version="1.0.0",
    lifespan=lifespan,
    description="REST API for construction quality walkthrough observations, LLM wording, and PPT/PDF reports.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mounted under /api so browser GETs to SPA paths (/upload, /reports) never hit REST routes.
API_PREFIX = "/api"
app.include_router(upload.router, prefix=API_PREFIX)
app.include_router(observations.router, prefix=API_PREFIX)
app.include_router(reports.router, prefix=API_PREFIX)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


# Served paths are relative to CWD — keep consistent with upload_service / report outputs
if Path(settings.upload_dir).exists():
    app.mount(
        "/static/uploads",
        StaticFiles(directory=str(settings.upload_dir)),
        name="uploads-static",
    )
if Path(settings.reports_dir).exists():
    app.mount(
        "/static/reports",
        StaticFiles(directory=str(settings.reports_dir)),
        name="reports-static",
    )
