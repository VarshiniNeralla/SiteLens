from pathlib import Path
import ipaddress
import socket
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import get_store_dep
from app.config import settings
from app.schemas.observation import ObservationCreate, ObservationOut, ObservationUpdate
from app.services import observation_service
from app.store import AppStore

router = APIRouter(prefix="/observations", tags=["observations"])


def _verify_image_reference(uri: str) -> None:
    s = (uri or "").strip()
    if not s:
        raise HTTPException(status_code=400, detail="Image reference is empty")
    if s.startswith("http://") or s.startswith("https://"):
        parsed = urlparse(s)
        host = (parsed.hostname or "").strip().lower()
        if not host:
            raise HTTPException(status_code=400, detail="Image URL host is invalid")
        allowed = settings.cloudinary_allowed_hosts_list()
        if allowed and not any(host == h or host.endswith(f".{h}") for h in allowed):
            raise HTTPException(status_code=400, detail="Image URL host is not allowed")
        try:
            resolved_ips = socket.gethostbyname_ex(host)[2]
        except socket.gaierror as e:
            raise HTTPException(status_code=400, detail=f"Image URL host lookup failed: {e}") from e
        for ip_raw in resolved_ips:
            ip = ipaddress.ip_address(ip_raw)
            if any(
                (
                    ip.is_private,
                    ip.is_loopback,
                    ip.is_link_local,
                    ip.is_reserved,
                    ip.is_multicast,
                    ip.is_unspecified,
                )
            ):
                raise HTTPException(status_code=400, detail="Image URL resolves to a blocked address")
        try:
            with httpx.Client(timeout=12.0, follow_redirects=False) as client:
                r = client.head(s)
                if r.status_code >= 400:
                    r = client.get(s, headers={"Range": "bytes=0-8191"})
                r.raise_for_status()
                ctype = (r.headers.get("content-type") or "").lower()
                if not ctype.startswith("image/"):
                    raise HTTPException(status_code=400, detail="Image URL must return an image content type")
        except httpx.HTTPError as e:
            raise HTTPException(
                status_code=400,
                detail=f"Image URL is not reachable (check Cloudinary/CORS/CDN): {e}",
            ) from e
        return
    p = Path(s)
    if not p.is_absolute():
        p = Path.cwd() / s
    if not p.is_file():
        raise HTTPException(status_code=400, detail=f"Image not found at {s}")


@router.post("", response_model=ObservationOut, status_code=201)
def create_observation(
    payload: ObservationCreate,
    store: AppStore = Depends(get_store_dep),
) -> ObservationOut:
    _verify_image_reference(payload.image_path)
    try:
        return observation_service.create_observation(store, payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


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
        _verify_image_reference(body.image_path)
    try:
        out = observation_service.update_observation(store, obs_id, body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    if out is None:
        raise HTTPException(status_code=404, detail="Observation not found")
    return out


@router.delete("/{obs_id}", status_code=204)
def delete_observation(
    obs_id: int,
    force: bool = Query(default=False),
    store: AppStore = Depends(get_store_dep),
) -> None:
    try:
        deleted = observation_service.delete_observation(store, obs_id, force=force)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    if not deleted:
        raise HTTPException(status_code=404, detail="Observation not found")
    return None
