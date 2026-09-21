from __future__ import annotations

import hashlib
import json
import os
import threading
from pathlib import Path

from .models import JobStatus, SynthesisRequest, WorkerJob, utc_now


class JobConflictError(Exception):
    pass


class WorkerStore:
    def __init__(self, data_dir: Path) -> None:
        self._path = data_dir / "worker-jobs.json"
        self._lock = threading.RLock()
        self._jobs: dict[str, WorkerJob] = {}
        self._load()

    @staticmethod
    def request_hash(request: SynthesisRequest) -> str:
        payload = request.model_dump_json(exclude={"job_id"})
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    def _load(self) -> None:
        if not self._path.exists():
            return
        try:
            payload = json.loads(self._path.read_text(encoding="utf-8"))
            if payload.get("version") != 1:
                raise ValueError("unsupported state version")
            for raw in payload.get("jobs", []):
                job = WorkerJob.model_validate(raw)
                if job.status in {JobStatus.QUEUED, JobStatus.RUNNING}:
                    job.status = JobStatus.FAILED
                    job.progress = 0
                    job.updated_at = utc_now()
                    job.message = "Worker restarted before this job completed. Use a new ID to retry."
                self._jobs[job.id] = job
            self._persist()
        except (OSError, ValueError, TypeError, json.JSONDecodeError) as error:
            raise RuntimeError(f"Worker state cannot be loaded: {error}") from error

    def _persist(self) -> None:
        payload = {"version": 1, "jobs": [job.model_dump(mode="json") for job in self._jobs.values()]}
        temporary = self._path.with_suffix(f".{os.getpid()}.tmp")
        temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(self._path)

    def create(self, request: SynthesisRequest) -> tuple[WorkerJob, bool]:
        with self._lock:
            digest = self.request_hash(request)
            existing = self._jobs.get(request.job_id)
            if existing:
                if existing.request_hash != digest:
                    raise JobConflictError("job_id already exists with a different request")
                return existing.model_copy(deep=True), False
            if any(job.status in {JobStatus.QUEUED, JobStatus.RUNNING} for job in self._jobs.values()):
                raise JobConflictError("the single-GPU worker already has an active job")
            now = utc_now()
            job = WorkerJob(id=request.job_id, request=request, request_hash=digest, status=JobStatus.QUEUED, progress=0, created_at=now, updated_at=now)
            self._jobs[job.id] = job
            self._persist()
            return job.model_copy(deep=True), True

    def get(self, job_id: str) -> WorkerJob | None:
        with self._lock:
            job = self._jobs.get(job_id)
            return job.model_copy(deep=True) if job else None

    def update(self, job_id: str, *, status: JobStatus | None = None, progress: int | None = None, message: str | None = None) -> WorkerJob | None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return None
            if job.status == JobStatus.CANCELLED:
                return job.model_copy(deep=True)
            if status is not None:
                job.status = status
            if progress is not None:
                job.progress = progress
            job.message = message
            job.updated_at = utc_now()
            self._persist()
            return job.model_copy(deep=True)

    def complete(self, job_id: str, *, output_path: str, audio_duration: float, message: str) -> WorkerJob | None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return None
            if job.status == JobStatus.CANCELLED:
                return job.model_copy(deep=True)
            job.status = JobStatus.SUCCEEDED
            job.progress = 100
            job.output_path = output_path
            job.audio_duration = audio_duration
            job.message = message
            job.updated_at = utc_now()
            self._persist()
            return job.model_copy(deep=True)

    def cancel(self, job_id: str) -> WorkerJob | None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return None
            if job.status in {JobStatus.QUEUED, JobStatus.RUNNING}:
                job.status = JobStatus.CANCELLED
                job.message = "Cancellation accepted. Any in-flight generation will discard its output."
                job.updated_at = utc_now()
                self._persist()
            return job.model_copy(deep=True)
