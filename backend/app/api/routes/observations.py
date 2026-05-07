from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import get_store_dep
from app.schemas.observation import ObservationCreate, ObservationOut, ObservationUpdate
from app.services import observation_service
from app.store import AppStore

router = APIRouter(prefix="/observations", tags=["observations"])


def _verify_image(image_path: str) -> None:
    p = Path(image_path)
    if not p.is_absolute():
        p = Path.cwd() / image_path
    if not p.is_file():
        raise HTTPException(status_code=400, detail=f"Image not found at {image_path}")


@router.post("", response_model=ObservationOut, status_code=201)
def create_observation(
    payload: ObservationCreate,
    store: AppStore = Depends(get_store_dep),
) -> ObservationOut:
    _verify_image(payload.image_path)
    try:
        return observation_service.create_observation(store, payload)
    except ValueError as e:
        detail = str(e)
        status = (
            502 if detail.startswith("Invalid response") or "language model" in detail else 400
        )
        raise HTTPException(status_code=status, detail=detail) from e
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Upstream LLM HTTP error: {e}") from e


@router.get("", response_model=list[ObservationOut])
def list_observations(
    project_id: int | None = Query(default=None),
    store: AppStore = Depends(get_store_dep),
) -> list[ObservationOut]:
    return observation_service.list_observations(store, project_id)


@router.get("/{obs_id}", response_model=ObservationOut)
def get_observation(obs_id: int, store: AppStore = Depends(get_store_dep)) -> ObservationOut:
    obs = observation_service.get_observation(store, obs_id)
    if obs is None:
        raise HTTPException(status_code=404, detail="Observation not found")
    return observation_service.observation_to_out(obs)


@router.put("/{obs_id}", response_model=ObservationOut)
def update_observation(
    obs_id: int,
    body: ObservationUpdate,
    store: AppStore = Depends(get_store_dep),
) -> ObservationOut:
    if body.image_path is not None:
        _verify_image(body.image_path)
    try:
        out = observation_service.update_observation(store, obs_id, body)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Upstream LLM HTTP error: {e}") from e
    except ValueError as e:
        detail = str(e)
        status = (
            502 if detail.startswith("Invalid response") or "language model" in detail else 400
        )
        raise HTTPException(status_code=status, detail=detail) from e
    if out is None:
        raise HTTPException(status_code=404, detail="Observation not found")
    return out
