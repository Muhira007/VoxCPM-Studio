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


class ExpressionSegmentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    index: int = Field(ge=0, lt=50)
    text: str = Field(min_length=1, max_length=5000)
    control_instruction: str | None = Field(default=None, max_length=1000)
    pause_after_ms: int = Field(default=0, ge=0, le=2000)


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
    control_instruction: str | None = Field(default=None, max_length=1000)
    segments: list[ExpressionSegmentRequest] = Field(default_factory=list, max_length=50)

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
        if self.mode == "hifi" and (self.control_instruction or self.segments):
            raise ValueError("Hi-Fi does not accept expression control.")
        if self.segments and [segment.index for segment in self.segments] != list(range(len(self.segments))):
            raise ValueError("Expression segment indexes must be sequential and start at zero.")
        return self


class WorkerSegment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    index: int = Field(ge=0, lt=50)
    status: JobStatus
    progress: int = Field(ge=0, le=100)
    message: str | None = None
    audio_duration: float | None = Field(default=None, gt=0)


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
    segments: list[WorkerSegment] = Field(default_factory=list)


class Readiness(BaseModel):
    ready: bool
    mode: Literal["simulation", "voxcpm2"]
    model_state: Literal["loading", "ready", "error"]
    message: str
    model_id: str | None = None
    device: str | None = None


class ReferenceUpload(BaseModel):
    id: str
    path: str
    size: int = Field(gt=0)
