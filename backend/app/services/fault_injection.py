from __future__ import annotations

import threading
import time


class FaultInjectionState:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._state: dict[str, dict[str, object]] = {
            "llm": {"enabled": False, "latency_ms": 0, "mode": "none"},
            "cloudinary": {"enabled": False, "latency_ms": 0, "mode": "none"},
            "export": {"enabled": False, "latency_ms": 0, "mode": "none"},
        }

    def snapshot(self) -> dict[str, dict[str, object]]:
        with self._lock:
            return {k: dict(v) for k, v in self._state.items()}

    def set_fault(self, target: str, *, enabled: bool, latency_ms: int, mode: str) -> dict[str, object]:
        with self._lock:
            if target not in self._state:
                raise ValueError(f"Unknown fault target: {target}")
            row = self._state[target]
            row["enabled"] = bool(enabled)
            row["latency_ms"] = max(0, int(latency_ms))
            row["mode"] = mode
            return dict(row)

    def reset(self) -> None:
        with self._lock:
            for row in self._state.values():
                row["enabled"] = False
                row["latency_ms"] = 0
                row["mode"] = "none"

    def apply(self, target: str) -> str:
        with self._lock:
            row = dict(self._state.get(target, {}))
        if not row or not row.get("enabled"):
            return "none"
        delay = int(row.get("latency_ms") or 0)
        if delay > 0:
            time.sleep(delay / 1000.0)
        return str(row.get("mode") or "none")


faults = FaultInjectionState()
