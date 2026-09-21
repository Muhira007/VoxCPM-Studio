from __future__ import annotations

import argparse
import json

from app.config import Settings
from app.inference import verify_gpu_environment, verify_installed_packages


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate the pinned VoxCPM2 GPU environment.")
    parser.add_argument("--build", action="store_true", help="Validate packages without requiring GPU hardware.")
    arguments = parser.parse_args()
    if arguments.build:
        print(json.dumps({"status": "ok", "packages": verify_installed_packages()}, sort_keys=True))
        return
    settings = Settings.from_environment()
    settings.validate()
    if settings.mode != "voxcpm2":
        raise RuntimeError("GPU preflight requires WORKER_MODE=voxcpm2.")
    device = verify_gpu_environment(settings)
    print(json.dumps({"status": "ok", "mode": settings.mode, "device": device}, sort_keys=True))


if __name__ == "__main__":
    main()
