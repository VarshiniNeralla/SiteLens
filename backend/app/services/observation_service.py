from dataclasses import replace
from datetime import date

from app.domain import ObservationRecord
from app.schemas.observation import ObservationCreate, ObservationOut, ObservationUpdate
from app.services import llm_service
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
    )


def _format_date(d: date | None) -> str:
    return d.isoformat() if d else "—"


def create_observation(store: AppStore, body: ObservationCreate) -> ObservationOut:
    pname = body.project_name.strip()
    project_id = store.project_id_for_name(pname)
    gen_obs = ""
    gen_rec = ""
    if body.generate_text:
        gen_obs, gen_rec = llm_service.generate_observation_text(
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
        )

    oid = store.allocate_observation_id()
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
        generated_observation=gen_obs,
        generated_recommendation=gen_rec,
        created_at=utcnow(),
    )
    store.add_observation(obs)
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
    obs = replace(old, **patches) if patches else old

    if regenerate:
        gen_obs, gen_rec = llm_service.generate_observation_text(
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
        )
        obs = replace(obs, generated_observation=gen_obs, generated_recommendation=gen_rec)

    store.replace_observation(obs)
    return observation_to_out(obs)
