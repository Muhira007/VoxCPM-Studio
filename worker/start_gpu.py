from __future__ import annotations

import os

import uvicorn

from app.config import Settings
from app.inference import verify_gpu_environment


if __name__ == "__main__":
    settings = Settings.from_environment()
    settings.validate()
    if settings.mode != "voxcpm2":
        raise RuntimeError("GPU image requires WORKER_MODE=voxcpm2.")
    print(f"GPU preflight passed: {verify_gpu_environment(settings)}", flush=True)
    uvicorn.run(
        "app.main:app",
        host=os.getenv("WORKER_HOST", "0.0.0.0"),
        port=int(os.getenv("WORKER_PORT", "8001")),
        proxy_headers=False,
        server_header=False,
    )
