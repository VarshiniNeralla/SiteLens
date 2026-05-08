from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field

from app.config import settings


@dataclass
class BreakerState:
    state: str = "closed"  # closed | open | half-open
    failures: list[float] = field(default_factory=list)
    open_until_ts: float = 0.0


class CircuitBreaker:
    def __init__(self, name: str) -> None:
        self.name = name
        self._lock = threading.Lock()
        self._state = BreakerState()

    def _trim_failures(self, now: float) -> None:
        window = max(1, settings.breaker_window_seconds)
        self._state.failures = [ts for ts in self._state.failures if now - ts <= window]

    def allow(self) -> bool:
        now = time.time()
        with self._lock:
            if self._state.state == "open":
                if now >= self._state.open_until_ts:
                    self._state.state = "half-open"
                    return True
                return False
            return True

    def record_success(self) -> None:
        with self._lock:
            self._state.state = "closed"
            self._state.failures.clear()
            self._state.open_until_ts = 0.0

    def record_failure(self) -> None:
        now = time.time()
        with self._lock:
            self._trim_failures(now)
            self._state.failures.append(now)
            threshold = max(1, settings.breaker_failure_threshold)
            if len(self._state.failures) >= threshold:
                self._state.state = "open"
                self._state.open_until_ts = now + max(1, settings.breaker_cooldown_seconds)

    def snapshot(self) -> dict[str, object]:
        now = time.time()
        with self._lock:
            self._trim_failures(now)
            return {
                "name": self.name,
                "state": self._state.state,
                "failures_in_window": len(self._state.failures),
                "open_until_ts": self._state.open_until_ts if self._state.state == "open" else None,
            }


_BREAKERS: dict[str, CircuitBreaker] = {}
_BREAKERS_LOCK = threading.Lock()


def get_breaker(name: str) -> CircuitBreaker:
    with _BREAKERS_LOCK:
        if name not in _BREAKERS:
            _BREAKERS[name] = CircuitBreaker(name)
        return _BREAKERS[name]


def all_breaker_snapshots() -> list[dict[str, object]]:
    with _BREAKERS_LOCK:
        return [b.snapshot() for b in _BREAKERS.values()]
