from app.store import AppStore, get_store


def get_store_dep() -> AppStore:
    return get_store()


__all__ = ["get_store_dep", "get_store"]
