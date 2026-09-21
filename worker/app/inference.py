from __future__ import annotations

import importlib
import importlib.metadata
import os
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from .config import Settings
from .models import SynthesisRequest


EXPECTED_PACKAGES = {
    "fastapi": "0.135.1",
    "starlette": "0.52.1",
    "torch": "2.8.0",
    "torchaudio": "2.8.0",
    "torchcodec": "0.7.0",
    "uvicorn": "0.42.0",
    "voxcpm": "2.0.3",
}

STYLE_INSTRUCTIONS = {
    "calm": "calm, steady delivery",
    "cheerful": "cheerful, warm delivery",
    "dramatic": "dramatic, expressive delivery",
}


@dataclass(frozen=True)
class RuntimeStatus:
    state: str
    message: str
    device: str | None = None


@dataclass(frozen=True)
class GenerationResult:
    output_path: Path
    audio_duration: float


class GenerationCancelled(RuntimeError):
    pass


def verify_installed_packages() -> dict[str, str]:
    versions: dict[str, str] = {}
    for package, expected in EXPECTED_PACKAGES.items():
        installed = importlib.metadata.version(package)
        normalized = installed.split("+", 1)[0]
        if normalized != expected:
            raise RuntimeError(f"{package} {expected} is required, but {installed} is installed.")
        versions[package] = installed
    importlib.import_module("soundfile")
    importlib.import_module("torchcodec")
    voxcpm = importlib.import_module("voxcpm")
    if not hasattr(voxcpm, "VoxCPM"):
        raise RuntimeError("The installed voxcpm package does not export VoxCPM.")
    return versions


def verify_gpu_environment(settings: Settings) -> str:
    versions = verify_installed_packages()
    torch = importlib.import_module("torch")
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is unavailable. WORKER_MODE=voxcpm2 requires an NVIDIA GPU visible to the container.")
    cuda_version = str(torch.version.cuda or "")
    try:
        cuda_major = int(cuda_version.split(".", 1)[0])
    except ValueError as error:
        raise RuntimeError(f"PyTorch reported an invalid CUDA version: {cuda_version or 'missing'}.") from error
    if cuda_major < 12:
        raise RuntimeError(f"CUDA 12 or newer is required, but PyTorch reports CUDA {cuda_version}.")
    properties = torch.cuda.get_device_properties(0)
    vram_gb = properties.total_memory / (1024**3)
    if vram_gb < settings.minimum_vram_gb:
        raise RuntimeError(
            f"GPU {properties.name} exposes {vram_gb:.1f} GiB VRAM; at least {settings.minimum_vram_gb:.1f} GiB is required."
        )
    return f"{properties.name}; {vram_gb:.1f} GiB VRAM; torch {versions['torch']}; CUDA {cuda_version}"


def generation_arguments(request: SynthesisRequest) -> dict[str, Any]:
    text = request.text
    arguments: dict[str, Any] = {}
    if request.mode == "design":
        text = f"({request.description}){text}"
    elif request.mode == "clone":
        instruction = STYLE_INSTRUCTIONS.get(request.style)
        if instruction:
            text = f"({instruction}){text}"
        arguments["reference_wav_path"] = request.reference_path
    elif request.mode == "hifi":
        arguments.update(
            prompt_wav_path=request.reference_path,
            prompt_text=request.transcript,
            reference_wav_path=request.reference_path,
        )
    arguments["text"] = text
    return arguments


class VoxCPMRuntime:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._state = RuntimeStatus("loading", "VoxCPM2 model load has not started.")
        self._state_lock = threading.RLock()
        self._generation_lock = threading.Lock()
        self._model: Any = None
        self._soundfile: Any = None

    def status(self) -> RuntimeStatus:
        with self._state_lock:
            return self._state

    def _set_status(self, state: str, message: str, device: str | None = None) -> None:
        with self._state_lock:
            self._state = RuntimeStatus(state, message, device)

    def start_loading(self) -> None:
        threading.Thread(target=self.load, daemon=True, name="voxcpm2-loader").start()

    def load(self) -> None:
        try:
            device = verify_gpu_environment(self.settings)
            self._set_status("loading", "Downloading or reading the pinned VoxCPM2 snapshot.", device)
            huggingface_hub = importlib.import_module("huggingface_hub")
            voxcpm = importlib.import_module("voxcpm")
            self._soundfile = importlib.import_module("soundfile")
            snapshot_path = huggingface_hub.snapshot_download(
                repo_id=self.settings.model_id,
                revision=self.settings.model_revision,
                cache_dir=str(self.settings.model_dir),
                local_files_only=self.settings.model_local_only,
            )
            self._set_status("loading", "Loading the pinned VoxCPM2 snapshot into GPU memory.", device)
            self._model = voxcpm.VoxCPM.from_pretrained(
                snapshot_path,
                load_denoiser=False,
                optimize=self.settings.model_optimize,
                device="cuda",
            )
            self._set_status("ready", "VoxCPM2 is loaded and ready for one job at a time.", device)
        except Exception as error:
            self._model = None
            self._set_status("error", f"VoxCPM2 model load failed: {type(error).__name__}: {error}")

    def generate(
        self,
        request: SynthesisRequest,
        output_path: Path,
        cancelled: Callable[[], bool],
    ) -> GenerationResult:
        if self.status().state != "ready" or self._model is None or self._soundfile is None:
            raise RuntimeError("VoxCPM2 is not ready.")
        with self._generation_lock:
            if cancelled():
                raise GenerationCancelled("Job was cancelled before generation started.")
            arguments = generation_arguments(request)
            arguments.update(
                cfg_value=self.settings.cfg_value,
                inference_timesteps=self.settings.inference_timesteps,
            )
            waveform = self._model.generate(**arguments)
            if cancelled():
                raise GenerationCancelled("Job was cancelled while generation was running.")
            sample_rate = int(self._model.tts_model.sample_rate)
            if sample_rate <= 0 or len(waveform) == 0:
                raise RuntimeError("VoxCPM2 returned an empty or invalid waveform.")
            output_path.parent.mkdir(parents=True, exist_ok=True)
            temporary = output_path.with_suffix(f"{output_path.suffix}.{os.getpid()}.tmp")
            try:
                self._soundfile.write(str(temporary), waveform, sample_rate, format="WAV", subtype="PCM_16")
                if cancelled():
                    raise GenerationCancelled("Job was cancelled before its output was committed.")
                temporary.replace(output_path)
            finally:
                temporary.unlink(missing_ok=True)
            return GenerationResult(output_path=output_path, audio_duration=len(waveform) / sample_rate)
