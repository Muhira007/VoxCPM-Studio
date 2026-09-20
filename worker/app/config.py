from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _path(name: str, default: str) -> Path:
    return Path(os.getenv(name, default)).expanduser().resolve()


@dataclass(frozen=True)
class Settings:
    mode: str
    api_key: str
    data_dir: Path
    model_dir: Path
    cache_dir: Path
    references_dir: Path
    outputs_dir: Path
    simulation_delay_ms: int

    @classmethod
    def from_environment(cls) -> "Settings":
        data_dir = _path("WORKER_DATA_DIR", ".data/worker")
        mode = os.getenv("WORKER_MODE", "simulation").strip().lower()
        if mode != "simulation":
            raise RuntimeError("Only WORKER_MODE=simulation is implemented. VoxCPM2 inference is not installed.")
        delay = int(os.getenv("WORKER_SIMULATION_DELAY_MS", "350"))
        if delay < 0 or delay > 60_000:
            raise RuntimeError("WORKER_SIMULATION_DELAY_MS must be between 0 and 60000.")
        return cls(
            mode=mode,
            api_key=os.getenv("WORKER_API_KEY", ""),
            data_dir=data_dir,
            model_dir=_path("WORKER_MODEL_DIR", str(data_dir / "models")),
            cache_dir=_path("WORKER_CACHE_DIR", str(data_dir / "cache")),
            references_dir=_path("WORKER_REFERENCES_DIR", str(data_dir / "references")),
            outputs_dir=_path("WORKER_OUTPUTS_DIR", str(data_dir / "outputs")),
            simulation_delay_ms=delay,
        )

    def validate(self) -> None:
        if len(self.api_key) < 32:
            raise RuntimeError("WORKER_API_KEY must contain at least 32 characters.")
        for path in self.storage_paths:
            path.mkdir(parents=True, exist_ok=True)
            probe = path / ".write-test"
            probe.write_text("ok", encoding="utf-8")
            probe.unlink()

    @property
    def storage_paths(self) -> tuple[Path, ...]:
        return (self.data_dir, self.model_dir, self.cache_dir, self.references_dir, self.outputs_dir)
