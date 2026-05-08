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
    total_calls: int = 0
    total_successes: int = 0
    total_failures: int = 0
    total_retries: int = 0
    consecutive_failures: int = 0
    last_success_ts: float | None = None
    last_failure_ts: float | None = None
    last_outage_ts: float | None = None
    last_recovery_ts: float | None = None
    avg_latency_ms: float | None = None
    latency_samples: int = 0


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

    def record_success(self, *, latency_ms: float | None = None, retries: int = 0) -> None:
        now = time.time()
        with self._lock:
            was_open = self._state.state in {"open", "half-open"}
            self._state.state = "closed"
            self._state.failures.clear()
            self._state.open_until_ts = 0.0
            self._state.total_calls += 1
            self._state.total_successes += 1
            self._state.total_retries += max(0, int(retries))
            self._state.consecutive_failures = 0
            self._state.last_success_ts = now
            if was_open:
                self._state.last_recovery_ts = now
            if latency_ms is not None and latency_ms >= 0:
                self._state.latency_samples += 1
                if self._state.avg_latency_ms is None:
                    self._state.avg_latency_ms = float(latency_ms)
                else:
                    # Simple EMA for stable operational telemetry.
                    self._state.avg_latency_ms = (self._state.avg_latency_ms * 0.75) + (float(latency_ms) * 0.25)

    def record_failure(self, *, latency_ms: float | None = None, retries: int = 0) -> None:
        now = time.time()
        with self._lock:
            self._trim_failures(now)
            self._state.failures.append(now)
            self._state.total_calls += 1
            self._state.total_failures += 1
            self._state.total_retries += max(0, int(retries))
            self._state.consecutive_failures += 1
            self._state.last_failure_ts = now
            if latency_ms is not None and latency_ms >= 0:
                self._state.latency_samples += 1
                if self._state.avg_latency_ms is None:
                    self._state.avg_latency_ms = float(latency_ms)
                else:
                    self._state.avg_latency_ms = (self._state.avg_latency_ms * 0.75) + (float(latency_ms) * 0.25)
            threshold = max(1, settings.breaker_failure_threshold)
            if len(self._state.failures) >= threshold:
                self._state.state = "open"
                self._state.open_until_ts = now + max(1, settings.breaker_cooldown_seconds)
                self._state.last_outage_ts = now

    def snapshot(self) -> dict[str, object]:
        now = time.time()
        with self._lock:
            self._trim_failures(now)
            total = self._state.total_successes + self._state.total_failures
            success_rate = (self._state.total_successes / total) if total else 1.0
            return {
                "name": self.name,
                "state": self._state.state,
                "failures_in_window": len(self._state.failures),
                "open_until_ts": self._state.open_until_ts if self._state.state == "open" else None,
                "total_calls": self._state.total_calls,
                "total_successes": self._state.total_successes,
                "total_failures": self._state.total_failures,
                "total_retries": self._state.total_retries,
                "consecutive_failures": self._state.consecutive_failures,
                "last_success_ts": self._state.last_success_ts,
                "last_failure_ts": self._state.last_failure_ts,
                "last_outage_ts": self._state.last_outage_ts,
                "last_recovery_ts": self._state.last_recovery_ts,
                "avg_latency_ms": self._state.avg_latency_ms,
                "success_rate": success_rate,
                "uptime_pct": round(success_rate * 100.0, 2),
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
