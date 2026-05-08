from dataclasses import replace
from datetime import date

from app.domain import ObservationRecord
from app.schemas.observation import ObservationCreate, ObservationOut, ObservationUpdate
from app.services import llm_service
from app.services.observation_text import user_facing_notice
from app.store import AppStore, utcnow

_UPDATABLE_FIELDS = frozenset(
    {
        "tower",
        "floor",
        "flat",
        "room",
        "observation_type",
        "severity",
        "site_visit_date",
        "slab_casting_date",
        "inspection_status",
        "third_party_status",
        "image_path",
        "cloudinary_public_id",
        "cloudinary_secure_url",
        "image_uploaded_at",
        "image_original_filename",
        "manually_written_observation",
    }
)


def observation_to_out(o: ObservationRecord) -> ObservationOut:
    return ObservationOut(
        id=o.id,
        project_name=o.project_name,
        tower=o.tower,
        floor=o.floor,
        flat=o.flat,
        room=o.room,
        observation_type=o.observation_type,
        severity=o.severity,
        site_visit_date=o.site_visit_date,
        slab_casting_date=o.slab_casting_date,
        inspection_status=o.inspection_status,
        third_party_status=o.third_party_status,
        image_path=o.image_path,
        generated_observation=o.generated_observation,
        generated_recommendation=o.generated_recommendation,
        created_at=o.created_at,
        manually_written_observation=o.manually_written_observation,
        ai_status=o.ai_status,
        ai_error=None,
        cloudinary_public_id=o.cloudinary_public_id,
        cloudinary_secure_url=o.cloudinary_secure_url,
        image_uploaded_at=o.image_uploaded_at,
        image_original_filename=o.image_original_filename,
        notice=user_facing_notice(o),
    )


def _format_date(d: date | None) -> str:
    return d.isoformat() if d else "—"


def create_observation(store: AppStore, body: ObservationCreate) -> ObservationOut:
    pname = body.project_name.strip()
    project_id = store.project_id_for_name(pname)
    manual = (body.manually_written_observation or "").strip()
    oid = store.allocate_observation_id()

    ai_status = "skipped" if not body.generate_text else "pending"
    obs = ObservationRecord(
        id=oid,
        project_id=project_id,
        project_name=pname,
        tower=body.tower,
        floor=body.floor,
        flat=body.flat,
        room=body.room,
        observation_type=body.observation_type,
        severity=body.severity,
        site_visit_date=body.site_visit_date,
        slab_casting_date=body.slab_casting_date,
        inspection_status=body.inspection_status,
        third_party_status=body.third_party_status,
        image_path=body.image_path,
        generated_observation="",
        generated_recommendation="",
        created_at=utcnow(),
        cloudinary_public_id=body.cloudinary_public_id or None,
        cloudinary_secure_url=body.cloudinary_secure_url or None,
        image_uploaded_at=body.image_uploaded_at,
        image_original_filename=body.image_original_filename or None,
        manually_written_observation=manual,
        ai_status=ai_status,
        ai_error=None,
    )
    store.add_observation(obs)

    if body.generate_text:
        result = llm_service.generate_observation_text_safe(
            tower=body.tower,
            floor=body.floor,
            flat=body.flat,
            room=body.room,
            observation_type=body.observation_type,
            severity=body.severity,
            site_visit_date=_format_date(body.site_visit_date),
            slab_casting_date=_format_date(body.slab_casting_date),
            inspection_status=body.inspection_status,
            third_party_status=body.third_party_status,
            image_url=body.cloudinary_secure_url or (body.image_path if body.image_path.startswith(("http://", "https://")) else None),
        )
        if result.ok:
            obs = replace(
                obs,
                generated_observation=result.observation,
                generated_recommendation=result.recommendation,
                ai_status="completed",
                ai_error=None,
            )
        else:
            obs = replace(
                obs,
                ai_status=result.ai_status,
                ai_error=result.ai_error_public,
                generated_observation="",
                generated_recommendation="",
            )
        store.replace_observation(obs)

    return observation_to_out(obs)


def list_observations(store: AppStore, project_id: int | None = None) -> list[ObservationOut]:
    return [observation_to_out(o) for o in store.list_observations(project_id)]


def get_observation(store: AppStore, obs_id: int) -> ObservationRecord | None:
    return store.get_observation(obs_id)


def update_observation(
    store: AppStore,
    obs_id: int,
    body: ObservationUpdate,
) -> ObservationOut | None:
    old = store.get_observation(obs_id)
    if old is None:
        return None

    raw = body.model_dump(exclude_unset=True)
    regenerate = bool(raw.pop("regenerate_text", False))
    patches = {k: v for k, v in raw.items() if k in _UPDATABLE_FIELDS}
    if patches.get("manually_written_observation") is None and "manually_written_observation" in patches:
        patches["manually_written_observation"] = ""
    obs = replace(old, **patches) if patches else old

    if regenerate:
        result = llm_service.generate_observation_text_safe(
            tower=obs.tower,
            floor=obs.floor,
            flat=obs.flat,
            room=obs.room,
            observation_type=obs.observation_type,
            severity=obs.severity,
            site_visit_date=_format_date(obs.site_visit_date),
            slab_casting_date=_format_date(obs.slab_casting_date),
            inspection_status=obs.inspection_status,
            third_party_status=obs.third_party_status,
            image_url=obs.cloudinary_secure_url or (obs.image_path if obs.image_path.startswith(("http://", "https://")) else None),
        )
        if result.ok:
            obs = replace(
                obs,
                generated_observation=result.observation,
                generated_recommendation=result.recommendation,
                ai_status="completed",
                ai_error=None,
            )
        else:
            obs = replace(
                obs,
                ai_status=result.ai_status,
                ai_error=result.ai_error_public,
                # Keep previous AI + manual text — only the latest refresh failed.
            )

    store.replace_observation(obs)
    return observation_to_out(obs)


def delete_observation(store: AppStore, obs_id: int, *, force: bool = False) -> bool:
    impacted = [r for r in store.list_reports_desc() if obs_id in r.observation_ids]
    if impacted and not force:
        report_ids = ", ".join(str(r.id) for r in impacted[:6])
        suffix = "..." if len(impacted) > 6 else ""
        raise ValueError(
            f"Observation #{obs_id} is already used in report(s) #{report_ids}{suffix}. "
            "Delete anyway with force=true."
        )
    if impacted and force:
        for r in impacted:
            store.upsert_report(
                replace(r, observation_ids=[oid for oid in r.observation_ids if oid != obs_id])
            )
    deleted = store.delete_observation(obs_id)
    return deleted is not None
