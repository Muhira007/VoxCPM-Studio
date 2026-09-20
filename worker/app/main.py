from __future__ import annotations

import hmac
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Response, status

from .config import Settings
from .models import JobStatus, Readiness, SynthesisRequest, WorkerJob
from .storage import JobConflictError, WorkerStore

settings = Settings.from_environment()
store: WorkerStore | None = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    global store
    settings.validate()
    store = WorkerStore(settings.data_dir)
    yield


app = FastAPI(title="VoxCPM Worker", version="0.1.0", lifespan=lifespan, docs_url=None, redoc_url=None)


def require_api_key(x_worker_key: Annotated[str | None, Header()] = None) -> None:
    if not x_worker_key or not hmac.compare_digest(x_worker_key, settings.api_key):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid worker credential.")


def current_store() -> WorkerStore:
    if store is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Worker storage is not ready.")
    return store


def is_cancelled(worker_store: WorkerStore, job_id: str) -> bool:
    job = worker_store.get(job_id)
    return job is None or job.status == JobStatus.CANCELLED


def simulate(job_id: str, scenario: str) -> None:
    worker_store = current_store()
    delay = settings.simulation_delay_ms / 1000
    if scenario == "slow":
        delay *= 4
    worker_store.update(job_id, status=JobStatus.RUNNING, progress=25, message="Simulation is validating the request.")
    time.sleep(delay)
    if is_cancelled(worker_store, job_id):
        return
    worker_store.update(job_id, progress=70, message="Simulation is exercising the worker contract.")
    time.sleep(delay)
    if is_cancelled(worker_store, job_id):
        return
    if scenario == "failure":
        worker_store.update(job_id, status=JobStatus.FAILED, progress=70, message="Requested simulation failure. No audio was created.")
    else:
        worker_store.update(job_id, status=JobStatus.SUCCEEDED, progress=100, message="Simulation completed. VoxCPM2 was not loaded and no audio was created.")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "voxcpm-worker", "mode": settings.mode}


@app.get("/v1/ready", response_model=Readiness, dependencies=[Depends(require_api_key)])
def readiness() -> Readiness:
    current_store()
    return Readiness(ready=True, mode="simulation", model_state="ready", message="Simulation contract is ready. VoxCPM2 is not loaded.")


@app.post("/v1/jobs", response_model=WorkerJob, dependencies=[Depends(require_api_key)])
def create_job(request: SynthesisRequest, response: Response) -> WorkerJob:
    if request.reference_path:
        reference = Path(request.reference_path).resolve()
        if not reference.is_relative_to(settings.references_dir) or not reference.is_file():
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="reference_path must point to an existing file inside WORKER_REFERENCES_DIR.")
    try:
        job, created = current_store().create(request)
    except JobConflictError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    if created:
        response.status_code = status.HTTP_202_ACCEPTED
        threading.Thread(target=simulate, args=(job.id, request.scenario), daemon=True, name=f"simulation-{job.id}").start()
    return job


@app.get("/v1/jobs/{job_id}", response_model=WorkerJob, dependencies=[Depends(require_api_key)])
def get_job(job_id: str) -> WorkerJob:
    job = current_store().get(job_id)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found.")
    return job


@app.post("/v1/jobs/{job_id}/cancel", response_model=WorkerJob, dependencies=[Depends(require_api_key)])
def cancel_job(job_id: str) -> WorkerJob:
    job = current_store().cancel(job_id)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found.")
    return job
