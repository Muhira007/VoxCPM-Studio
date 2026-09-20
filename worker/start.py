from __future__ import annotations

import os

import uvicorn

from app.config import Settings


if __name__ == "__main__":
    Settings.from_environment().validate()
    uvicorn.run(
        "app.main:app",
        host=os.getenv("WORKER_HOST", "0.0.0.0"),
        port=int(os.getenv("WORKER_PORT", "8001")),
        proxy_headers=False,
        server_header=False,
    )
