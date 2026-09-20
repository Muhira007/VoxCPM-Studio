from __future__ import annotations

from datetime import datetime, timezone
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class JobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


class SynthesisRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    job_id: str = Field(pattern=r"^[A-Za-z0-9_-]{8,80}$")
    text: str = Field(min_length=1, max_length=5000)
    mode: Literal["tts", "design", "clone", "hifi"]
    voice_id: str = Field(default="", max_length=120)
    description: str = Field(default="", max_length=1000)
    transcript: str = Field(default="", max_length=5000)
    style: Literal["natural", "calm", "cheerful", "dramatic"] = "natural"
    reference_path: str | None = Field(default=None, max_length=500)
    scenario: Literal["normal", "failure", "slow"] = "normal"

    @model_validator(mode="after")
    def validate_mode_requirements(self) -> "SynthesisRequest":
        if self.mode == "design" and not self.description:
            raise ValueError("Voice Design requires description.")
        if self.mode in {"clone", "hifi"} and not self.reference_path:
            raise ValueError("Cloning requires reference_path.")
        if self.mode == "hifi" and not self.transcript:
            raise ValueError("Hi-Fi requires transcript.")
        if self.mode == "hifi" and self.style != "natural":
            raise ValueError("Hi-Fi does not accept a style override.")
        return self


class WorkerJob(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    request: SynthesisRequest
    request_hash: str
    status: JobStatus
    progress: int = Field(ge=0, le=100)
    created_at: datetime
    updated_at: datetime
    message: str | None = None
    output_path: str | None = None
    audio_duration: float | None = None


class Readiness(BaseModel):
    ready: bool
    mode: Literal["simulation"]
    model_state: Literal["ready", "error"]
    message: str
