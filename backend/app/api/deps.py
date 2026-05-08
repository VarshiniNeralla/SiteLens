from fastapi import Request

from app.store import AppStore


def get_store_dep(request: Request) -> AppStore:
    return request.app.state.store


__all__ = ["get_store_dep"]
