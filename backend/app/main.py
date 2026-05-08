from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI
from fastapi import Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.responses import JSONResponse

from app.api.routes import observations, ops, reports, upload
from app.config import settings
from app.logging_config import get_logger, setup_logging
from app.services import cloudinary_service
from app.services.report_jobs import job_manager
from app.services.report_service import process_report_generation
from app.store import MongoConnectionManager
from app.services.upload_sessions import UploadSessionStore

setup_logging()
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ARG001
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    settings.reports_dir.mkdir(parents=True, exist_ok=True)
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    mongo = MongoConnectionManager()
    store = await mongo.connect()
    app.state.mongo = mongo
    app.state.store = store
    app.state.upload_sessions = UploadSessionStore(store)
    mongo_health = await store.mongo_health()
    if mongo_health["status"] == "connected":
        logger.info(
            "MongoDB connected db=%s latency_ms=%s",
            settings.mongodb_db,
            mongo_health.get("latency_ms"),
        )
    else:
        logger.warning(
            "MongoDB degraded db=%s reason=%s",
            settings.mongodb_db,
            mongo_health.get("reason"),
        )
    cloudinary_health = cloudinary_service.startup_health()
    if cloudinary_health["status"] == "connected":
        logger.info(
            "Cloudinary connected cloud_name=%s folder=%s",
            cloudinary_health.get("cloud_name"),
            cloudinary_health.get("folder"),
        )
    elif cloudinary_health["status"] == "disabled":
        logger.info("Cloudinary disabled reason=%s", cloudinary_health.get("reason"))
    else:
        logger.warning("Cloudinary degraded reason=%s", cloudinary_health.get("reason"))
    recovered = await job_manager.recover_pending(
        store,
        lambda report_id: (lambda: process_report_generation(store, report_id=report_id)),
    )
    if recovered:
        logger.info("Recovered %s pending report job(s) after restart", recovered)
    logger.info("Mongo datastore ready")
    yield
    await mongo.close()


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
app.include_router(ops.router, prefix=API_PREFIX)


@app.middleware("http")
async def correlation_middleware(request: Request, call_next):
    cid = request.headers.get("X-Correlation-Id") or uuid4().hex
    request.state.correlation_id = cid
    try:
        response = await call_next(request)
        response.headers["X-Correlation-Id"] = cid
        return response
    except Exception as exc:  # noqa: BLE001
        logger.exception("Unhandled error cid=%s path=%s err=%s", cid, request.url.path, exc)
        return JSONResponse(
            status_code=500,
            content={"detail": "Unexpected server error", "correlation_id": cid},
        )


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
