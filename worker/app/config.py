from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path


DEFAULT_MODEL_ID = "openbmb/VoxCPM2"
DEFAULT_MODEL_REVISION = "32279effe8c19989596f05d353d1447f51d9e915"


def _path(name: str, default: str) -> Path:
    return Path(os.getenv(name, default)).expanduser().resolve()


def _boolean(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise RuntimeError(f"{name} must be true or false.")


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
    model_id: str = DEFAULT_MODEL_ID
    model_revision: str = DEFAULT_MODEL_REVISION
    model_local_only: bool = False
    model_optimize: bool = True
    minimum_vram_gb: float = 8.0
    inference_timesteps: int = 10
    cfg_value: float = 2.0

    @classmethod
    def from_environment(cls) -> "Settings":
        data_dir = _path("WORKER_DATA_DIR", ".data/worker")
        mode = os.getenv("WORKER_MODE", "simulation").strip().lower()
        if mode not in {"simulation", "voxcpm2"}:
            raise RuntimeError("WORKER_MODE must be simulation or voxcpm2.")
        delay = int(os.getenv("WORKER_SIMULATION_DELAY_MS", "350"))
        if delay < 0 or delay > 60_000:
            raise RuntimeError("WORKER_SIMULATION_DELAY_MS must be between 0 and 60000.")
        minimum_vram_gb = float(os.getenv("WORKER_MINIMUM_VRAM_GB", "8"))
        inference_timesteps = int(os.getenv("WORKER_INFERENCE_TIMESTEPS", "10"))
        cfg_value = float(os.getenv("WORKER_CFG_VALUE", "2.0"))
        return cls(
            mode=mode,
            api_key=os.getenv("WORKER_API_KEY", ""),
            data_dir=data_dir,
            model_dir=_path("WORKER_MODEL_DIR", str(data_dir / "models")),
            cache_dir=_path("WORKER_CACHE_DIR", str(data_dir / "cache")),
            references_dir=_path("WORKER_REFERENCES_DIR", str(data_dir / "references")),
            outputs_dir=_path("WORKER_OUTPUTS_DIR", str(data_dir / "outputs")),
            simulation_delay_ms=delay,
            model_id=os.getenv("WORKER_MODEL_ID", DEFAULT_MODEL_ID).strip(),
            model_revision=os.getenv("WORKER_MODEL_REVISION", DEFAULT_MODEL_REVISION).strip().lower(),
            model_local_only=_boolean("WORKER_MODEL_LOCAL_ONLY", False),
            model_optimize=_boolean("WORKER_MODEL_OPTIMIZE", True),
            minimum_vram_gb=minimum_vram_gb,
            inference_timesteps=inference_timesteps,
            cfg_value=cfg_value,
        )

    def validate(self) -> None:
        if len(self.api_key) < 32:
            raise RuntimeError("WORKER_API_KEY must contain at least 32 characters.")
        if self.mode == "voxcpm2":
            if not self.model_id:
                raise RuntimeError("WORKER_MODEL_ID must not be empty.")
            if not re.fullmatch(r"[0-9a-f]{40}", self.model_revision):
                raise RuntimeError("WORKER_MODEL_REVISION must be a pinned 40-character commit SHA.")
            if self.minimum_vram_gb < 1 or self.minimum_vram_gb > 128:
                raise RuntimeError("WORKER_MINIMUM_VRAM_GB must be between 1 and 128.")
            if self.inference_timesteps < 1 or self.inference_timesteps > 100:
                raise RuntimeError("WORKER_INFERENCE_TIMESTEPS must be between 1 and 100.")
            if self.cfg_value < 0.1 or self.cfg_value > 10:
                raise RuntimeError("WORKER_CFG_VALUE must be between 0.1 and 10.")
        for path in self.storage_paths:
            path.mkdir(parents=True, exist_ok=True)
            probe = path / ".write-test"
            probe.write_text("ok", encoding="utf-8")
            probe.unlink()

    @property
    def storage_paths(self) -> tuple[Path, ...]:
        return (self.data_dir, self.model_dir, self.cache_dir, self.references_dir, self.outputs_dir)
