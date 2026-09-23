from __future__ import annotations

import hmac
import re
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response, status
from fastapi.responses import FileResponse

from .audio import merge_pcm16_wavs
from .config import Settings
from .inference import GenerationCancelled, VoxCPMRuntime
from .models import JobStatus, Readiness, ReferenceUpload, SynthesisRequest, WorkerJob
from .storage import JobConflictError, WorkerStore

settings = Settings.from_environment()
store: WorkerStore | None = None
inference_runtime: VoxCPMRuntime | None = None

REFERENCE_ID = re.compile(r"^[A-Za-z0-9_-]{8,120}$")
REFERENCE_EXTENSION = re.compile(r"^\.[a-z0-9]{2,5}$")
MAX_REFERENCE_BYTES = 20 * 1024 * 1024


@asynccontextmanager
async def lifespan(_: FastAPI):
    global store, inference_runtime
    settings.validate()
    store = WorkerStore(settings.data_dir)
    inference_runtime = None
    if settings.mode == "voxcpm2":
        inference_runtime = VoxCPMRuntime(settings)
        inference_runtime.start_loading()
    yield


app = FastAPI(title="VoxCPM Worker", version="0.3.0", lifespan=lifespan, docs_url=None, redoc_url=None)


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


def simulate(job_id: str, scenario: str, retry_index: int | None = None) -> None:
    worker_store = current_store()
    delay = settings.simulation_delay_ms / 1000
    if scenario == "slow":
        delay *= 4
    job = worker_store.get(job_id)
    if job and job.request.segments:
        pending = [
            segment.index
            for segment in job.segments
            if segment.status != JobStatus.SUCCEEDED
        ]
        if retry_index is not None and retry_index in pending:
            pending.remove(retry_index)
            pending.insert(0, retry_index)
        total = len(job.segments)
        for segment_index in pending:
            completed = sum(
                segment.status == JobStatus.SUCCEEDED
                for segment in (worker_store.get(job_id) or job).segments
            )
            worker_store.update_segment(
                job_id,
                segment_index,
                status=JobStatus.RUNNING,
                progress=25,
                message=f"Simulasi sedang memeriksa segmen {segment_index + 1}.",
                job_progress=max(1, int(90 * completed / total)),
            )
            time.sleep(delay)
            if is_cancelled(worker_store, job_id):
                return
            if scenario == "failure":
                worker_store.update_segment(
                    job_id,
                    segment_index,
                    status=JobStatus.FAILED,
                    progress=70,
                    message=f"Skenario simulasi gagal pada segmen {segment_index + 1}.",
                    job_status=JobStatus.FAILED,
                    job_progress=max(1, int(90 * completed / total)),
                )
                return
            worker_store.update_segment(
                job_id,
                segment_index,
                status=JobStatus.SUCCEEDED,
                progress=100,
                message="Kontrak segmen selesai tanpa membuat audio sintetis.",
                job_progress=int(90 * (completed + 1) / total),
            )
        worker_store.update(
            job_id,
            status=JobStatus.SUCCEEDED,
            progress=100,
            message="Simulasi per segmen selesai. VoxCPM2 tidak dimuat dan tidak ada audio yang dibuat.",
        )
        return
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


def synthesize(job_id: str, request: SynthesisRequest, retry_index: int | None = None) -> None:
    worker_store = current_store()
    runtime = inference_runtime
    if runtime is None:
        worker_store.update(job_id, status=JobStatus.FAILED, message="VoxCPM2 runtime is unavailable.")
        return
    output_path = settings.outputs_dir / f"{job_id}.wav"
    if request.segments:
        active_index: int | None = None
        try:
            job = worker_store.get(job_id)
            if not job:
                return
            pending = [
                segment.index
                for segment in job.segments
                if segment.status != JobStatus.SUCCEEDED
            ]
            if retry_index is not None and retry_index in pending:
                pending.remove(retry_index)
                pending.insert(0, retry_index)
            total = len(request.segments)
            part_directory = settings.outputs_dir / f"{job_id}.segments"
            part_directory.mkdir(parents=True, exist_ok=True)
            for segment_index in pending:
                active_index = segment_index
                current = worker_store.get(job_id)
                if current is None or current.status == JobStatus.CANCELLED:
                    return
                completed = sum(
                    segment.status == JobStatus.SUCCEEDED
                    for segment in current.segments
                )
                worker_store.update_segment(
                    job_id,
                    segment_index,
                    status=JobStatus.RUNNING,
                    progress=10,
                    message=f"VoxCPM2 sedang membuat segmen {segment_index + 1} dari {total}.",
                    job_progress=max(1, int(90 * completed / total)),
                )
                segment = request.segments[segment_index]
                segment_request = request.model_copy(
                    update={
                        "text": segment.text,
                        "control_instruction": segment.control_instruction,
                        "segments": [],
                    }
                )
                result = runtime.generate(
                    segment_request,
                    part_directory / f"{segment_index:03}.wav",
                    lambda: is_cancelled(worker_store, job_id),
                )
                if is_cancelled(worker_store, job_id):
                    return
                worker_store.update_segment(
                    job_id,
                    segment_index,
                    status=JobStatus.SUCCEEDED,
                    progress=100,
                    message=f"Audio segmen {segment_index + 1} siap.",
                    audio_duration=result.audio_duration,
                    job_progress=int(90 * (completed + 1) / total),
                )
            active_index = None
            part_paths = [
                part_directory / f"{segment.index:03}.wav"
                for segment in request.segments
            ]
            if not all(path.is_file() for path in part_paths):
                raise RuntimeError("One or more segment WAV files are missing.")
            worker_store.update(
                job_id,
                status=JobStatus.RUNNING,
                progress=95,
                message="Menormalisasi dan menggabungkan segmen ekspresif.",
            )
            merged = merge_pcm16_wavs(
                part_paths,
                [segment.pause_after_ms for segment in request.segments],
                output_path,
            )
            if is_cancelled(worker_store, job_id):
                output_path.unlink(missing_ok=True)
                return
            worker_store.complete(
                job_id,
                output_path=str(merged.output_path),
                audio_duration=merged.duration,
                message=f"VoxCPM2 selesai menggabungkan {total} segmen ekspresif.",
            )
        except GenerationCancelled:
            return
        except Exception as error:
            message = f"VoxCPM2 segmented generation failed: {type(error).__name__}: {error}"
            if active_index is None:
                worker_store.update(job_id, status=JobStatus.FAILED, message=message)
            else:
                worker_store.update_segment(
                    job_id,
                    active_index,
                    status=JobStatus.FAILED,
                    progress=0,
                    message=message,
                    job_status=JobStatus.FAILED,
                )
        return
    try:
        worker_store.update(job_id, status=JobStatus.RUNNING, progress=10, message="VoxCPM2 is generating audio on the GPU.")
        result = runtime.generate(request, output_path, lambda: is_cancelled(worker_store, job_id))
        if is_cancelled(worker_store, job_id):
            result.output_path.unlink(missing_ok=True)
            return
        worker_store.complete(
            job_id,
            output_path=str(result.output_path),
            audio_duration=result.audio_duration,
            message="VoxCPM2 generation completed and the WAV output was saved.",
        )
    except GenerationCancelled:
        output_path.unlink(missing_ok=True)
    except Exception as error:
        output_path.unlink(missing_ok=True)
        worker_store.update(
            job_id,
            status=JobStatus.FAILED,
            message=f"VoxCPM2 generation failed: {type(error).__name__}: {error}",
        )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "voxcpm-worker", "mode": settings.mode}


@app.get("/v1/ready", response_model=Readiness, dependencies=[Depends(require_api_key)])
def readiness() -> Readiness:
    current_store()
    if settings.mode == "simulation":
        return Readiness(ready=True, mode="simulation", model_state="ready", message="Simulation contract is ready. VoxCPM2 is not loaded.")
    runtime = inference_runtime
    if runtime is None:
        return Readiness(ready=False, mode="voxcpm2", model_state="error", message="VoxCPM2 runtime was not initialized.", model_id=settings.model_id)
    runtime_status = runtime.status()
    return Readiness(
        ready=runtime_status.state == "ready",
        mode="voxcpm2",
        model_state=runtime_status.state,
        message=runtime_status.message,
        model_id=f"{settings.model_id}@{settings.model_revision}",
        device=runtime_status.device,
    )


@app.put("/v1/references/{reference_id}", response_model=ReferenceUpload, dependencies=[Depends(require_api_key)])
async def upload_reference(
    reference_id: str,
    request: Request,
    x_reference_extension: Annotated[str | None, Header()] = None,
) -> ReferenceUpload:
    if not REFERENCE_ID.fullmatch(reference_id):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid reference ID.")
    extension = (x_reference_extension or ".wav").strip().lower()
    if not REFERENCE_EXTENSION.fullmatch(extension):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Invalid reference extension.")
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            declared_size = int(content_length)
        except ValueError as error:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Content-Length.") from error
        if declared_size < 1 or declared_size > MAX_REFERENCE_BYTES:
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Reference audio must be between 1 byte and 20 MB.")
    payload = await request.body()
    if len(payload) < 1 or len(payload) > MAX_REFERENCE_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Reference audio must be between 1 byte and 20 MB.")
    destination = (settings.references_dir / f"{reference_id}{extension}").resolve()
    if not destination.is_relative_to(settings.references_dir):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Reference path escaped storage.")
    temporary = destination.with_suffix(f"{destination.suffix}.upload.tmp")
    temporary.write_bytes(payload)
    for previous in settings.references_dir.glob(f"{reference_id}.*"):
        if previous != temporary and previous != destination and previous.is_file():
            previous.unlink(missing_ok=True)
    temporary.replace(destination)
    return ReferenceUpload(id=reference_id, path=str(destination), size=len(payload))


@app.post("/v1/jobs", response_model=WorkerJob, dependencies=[Depends(require_api_key)])
def create_job(request: SynthesisRequest, response: Response) -> WorkerJob:
    if settings.mode == "voxcpm2":
        runtime_status = inference_runtime.status() if inference_runtime else None
        if runtime_status is None or runtime_status.state != "ready":
            detail = runtime_status.message if runtime_status else "VoxCPM2 runtime is unavailable."
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=detail)
        if request.scenario != "normal":
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Demo scenarios are only available in simulation mode.")
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
        target = simulate if settings.mode == "simulation" else synthesize
        args = (job.id, request.scenario) if settings.mode == "simulation" else (job.id, request)
        threading.Thread(target=target, args=args, daemon=True, name=f"{settings.mode}-{job.id}").start()
    return job


@app.post(
    "/v1/jobs/{job_id}/segments/{segment_index}/retry",
    response_model=WorkerJob,
    dependencies=[Depends(require_api_key)],
)
def retry_segment(job_id: str, segment_index: int, response: Response) -> WorkerJob:
    if settings.mode == "voxcpm2":
        runtime_status = inference_runtime.status() if inference_runtime else None
        if runtime_status is None or runtime_status.state != "ready":
            detail = runtime_status.message if runtime_status else "VoxCPM2 runtime is unavailable."
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=detail)
    try:
        job = current_store().begin_segment_retry(job_id, segment_index)
    except JobConflictError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    response.status_code = status.HTTP_202_ACCEPTED
    target = simulate if settings.mode == "simulation" else synthesize
    args = (
        (job.id, "normal", segment_index)
        if settings.mode == "simulation"
        else (job.id, job.request, segment_index)
    )
    threading.Thread(
        target=target,
        args=args,
        daemon=True,
        name=f"{settings.mode}-{job.id}-segment-{segment_index}",
    ).start()
    return job


@app.get("/v1/jobs/{job_id}", response_model=WorkerJob, dependencies=[Depends(require_api_key)])
def get_job(job_id: str) -> WorkerJob:
    job = current_store().get(job_id)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found.")
    return job


@app.get("/v1/jobs/{job_id}/audio", dependencies=[Depends(require_api_key)])
def get_job_audio(job_id: str) -> FileResponse:
    job = current_store().get(job_id)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found.")
    if job.status != JobStatus.SUCCEEDED or not job.output_path:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Job audio is not available.")
    output = Path(job.output_path).resolve()
    if not output.is_relative_to(settings.outputs_dir) or not output.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job output file is missing.")
    return FileResponse(output, media_type="audio/wav", filename=f"{job_id}.wav", headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})


@app.post("/v1/jobs/{job_id}/cancel", response_model=WorkerJob, dependencies=[Depends(require_api_key)])
def cancel_job(job_id: str) -> WorkerJob:
    job = current_store().cancel(job_id)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found.")
    return job
