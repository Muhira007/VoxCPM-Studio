from __future__ import annotations

import time
import wave
from array import array
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from worker.app import main
from worker.app.config import Settings
from worker.app.inference import GenerationResult, VoxCPMRuntime, generation_arguments
from worker.app.models import SynthesisRequest
from worker.app.storage import WorkerStore

API_KEY = "worker-test-key-with-at-least-32-characters"
HEADERS = {"X-Worker-Key": API_KEY}


@pytest.fixture
def client(tmp_path: Path):
    references = tmp_path / "references"
    main.settings = Settings(
        mode="simulation",
        api_key=API_KEY,
        data_dir=tmp_path / "worker",
        model_dir=tmp_path / "models",
        cache_dir=tmp_path / "cache",
        references_dir=references,
        outputs_dir=tmp_path / "outputs",
        simulation_delay_ms=20,
    )
    with TestClient(main.app) as test_client:
        yield test_client, references


def payload(job_id: str, **updates: object) -> dict[str, object]:
    request: dict[str, object] = {
        "job_id": job_id,
        "text": "Selamat datang di pengujian worker lokal.",
        "mode": "tts",
        "style": "natural",
    }
    request.update(updates)
    return request


def wait_for_terminal(client: TestClient, job_id: str) -> dict[str, object]:
    for _ in range(50):
        job = client.get(f"/v1/jobs/{job_id}", headers=HEADERS).json()
        if job["status"] in {"succeeded", "failed", "cancelled"}:
            return job
        time.sleep(0.01)
    raise AssertionError("job did not reach a terminal state")


def test_health_is_public_but_readiness_requires_worker_key(client):
    test_client, _ = client
    assert test_client.get("/health").json() == {"status": "ok", "service": "voxcpm-worker", "mode": "simulation"}
    assert test_client.get("/v1/ready").status_code == 401
    readiness = test_client.get("/v1/ready", headers=HEADERS)
    assert readiness.status_code == 200
    assert readiness.json()["ready"] is True
    assert "not loaded" in readiness.json()["message"]


def test_job_is_idempotent_and_never_claims_audio(client):
    test_client, _ = client
    created = test_client.post("/v1/jobs", headers=HEADERS, json=payload("job-normal-001"))
    assert created.status_code == 202
    duplicate = test_client.post("/v1/jobs", headers=HEADERS, json=payload("job-normal-001"))
    assert duplicate.status_code == 200
    conflict = test_client.post("/v1/jobs", headers=HEADERS, json=payload("job-normal-001", text="Berbeda"))
    assert conflict.status_code == 409
    result = wait_for_terminal(test_client, "job-normal-001")
    assert result["status"] == "succeeded"
    assert result["output_path"] is None
    assert result["audio_duration"] is None
    assert "not loaded" in result["message"]


def test_worker_rejects_parallel_jobs_and_allows_retry_after_cancel(client):
    test_client, _ = client
    assert test_client.post("/v1/jobs", headers=HEADERS, json=payload("job-active-001", scenario="slow")).status_code == 202
    assert test_client.post("/v1/jobs", headers=HEADERS, json=payload("job-active-002")).status_code == 409
    cancelled = test_client.post("/v1/jobs/job-active-001/cancel", headers=HEADERS)
    assert cancelled.json()["status"] == "cancelled"
    assert test_client.post("/v1/jobs", headers=HEADERS, json=payload("job-active-002")).status_code == 202


def test_failure_and_validation_paths(client):
    test_client, references = client
    failed = test_client.post("/v1/jobs", headers=HEADERS, json=payload("job-failure-1", scenario="failure"))
    assert failed.status_code == 202
    assert wait_for_terminal(test_client, "job-failure-1")["status"] == "failed"
    missing_description = test_client.post("/v1/jobs", headers=HEADERS, json=payload("job-design-01", mode="design"))
    assert missing_description.status_code == 422
    escaped_reference = test_client.post("/v1/jobs", headers=HEADERS, json=payload("job-clone-001", mode="clone", reference_path=str(references.parent / "outside.wav")))
    assert escaped_reference.status_code == 422
    references.mkdir(parents=True, exist_ok=True)
    reference = references / "voice.wav"
    reference.write_bytes(b"RIFF-test")
    valid_clone = test_client.post("/v1/jobs", headers=HEADERS, json=payload("job-clone-002", mode="clone", reference_path=str(reference)))
    assert valid_clone.status_code == 202


def test_reference_upload_and_authenticated_audio_download(client):
    test_client, references = client
    uploaded = test_client.put(
        "/v1/references/voice-test-001",
        headers={**HEADERS, "X-Reference-Extension": ".wav", "Content-Type": "application/octet-stream"},
        content=b"RIFF-reference",
    )
    assert uploaded.status_code == 200
    uploaded_path = Path(uploaded.json()["path"])
    assert uploaded_path.parent == references.resolve()
    assert uploaded_path.read_bytes() == b"RIFF-reference"

    created = test_client.post("/v1/jobs", headers=HEADERS, json=payload("job-audio-001"))
    assert created.status_code == 202
    wait_for_terminal(test_client, "job-audio-001")
    output = main.settings.outputs_dir / "job-audio-001.wav"
    output.write_bytes(b"RIFF-output")
    assert main.store is not None
    main.store.complete("job-audio-001", output_path=str(output), audio_duration=0.25, message="Ready")
    assert test_client.get("/v1/jobs/job-audio-001/audio").status_code == 401
    downloaded = test_client.get("/v1/jobs/job-audio-001/audio", headers=HEADERS)
    assert downloaded.status_code == 200
    assert downloaded.headers["content-type"].startswith("audio/wav")
    assert downloaded.content == b"RIFF-output"


def test_voxcpm2_mode_mapping_matches_upstream_api():
    design = SynthesisRequest(**payload("job-design-map", mode="design", description="suara pria hangat"))
    assert generation_arguments(design) == {"text": "(suara pria hangat)Selamat datang di pengujian worker lokal."}

    clone = SynthesisRequest(**payload("job-clone-map", mode="clone", style="cheerful", reference_path="/workspace/references/voice.wav"))
    clone_arguments = generation_arguments(clone)
    assert clone_arguments["text"].startswith("(cheerful, warm delivery)")
    assert clone_arguments["reference_wav_path"] == "/workspace/references/voice.wav"

    expressive_clone = SynthesisRequest(
        **payload(
            "job-clone-expression-map",
            mode="clone",
            style="cheerful",
            reference_path="/workspace/references/voice.wav",
            control_instruction="excited and fast-paced",
        )
    )
    assert generation_arguments(expressive_clone)["text"].startswith(
        "(cheerful, warm delivery, excited and fast-paced)"
    )

    hifi = SynthesisRequest(**payload("job-hifi-map", mode="hifi", transcript="Teks referensi.", reference_path="/workspace/references/voice.wav"))
    hifi_arguments = generation_arguments(hifi)
    assert hifi_arguments["prompt_wav_path"] == hifi_arguments["reference_wav_path"]
    assert hifi_arguments["prompt_text"] == "Teks referensi."


def test_voxcpm2_runtime_writes_an_atomic_wav_without_real_gpu(tmp_path: Path):
    class FakeModel:
        tts_model = type("TtsModel", (), {"sample_rate": 4})()

        def generate(self, **arguments):
            assert arguments["text"] == "Uji keluaran."
            assert arguments["cfg_value"] == 2.0
            assert arguments["inference_timesteps"] == 10
            return [0.0, 0.25, -0.25, 0.0]

    class FakeSoundFile:
        @staticmethod
        def write(path, waveform, sample_rate, **options):
            assert len(waveform) == sample_rate
            assert options == {"format": "WAV", "subtype": "PCM_16"}
            Path(path).write_bytes(b"RIFF-fake-wave")

    runtime = VoxCPMRuntime(
        Settings(
            mode="voxcpm2",
            api_key=API_KEY,
            data_dir=tmp_path / "worker",
            model_dir=tmp_path / "models",
            cache_dir=tmp_path / "cache",
            references_dir=tmp_path / "references",
            outputs_dir=tmp_path / "outputs",
            simulation_delay_ms=0,
        )
    )
    runtime._model = FakeModel()
    runtime._soundfile = FakeSoundFile()
    runtime._set_status("ready", "Ready", "Fake GPU")
    request = SynthesisRequest(**payload("job-output-map", text="Uji keluaran."))
    output = tmp_path / "outputs" / "job-output-map.wav"
    result = runtime.generate(request, output, lambda: False)
    assert result.audio_duration == 1.0
    assert output.read_bytes() == b"RIFF-fake-wave"
    assert not list(output.parent.glob("*.tmp"))


def test_segmented_simulation_tracks_each_segment_and_allows_retry(client):
    test_client, _ = client
    expressive = payload(
        "job-segment-sim-001",
        text="[shouts] Berhenti! [curious] Kenapa?",
        segments=[
            {
                "index": 0,
                "text": "Berhenti!",
                "control_instruction": "Shout with strong emphasis.",
                "pause_after_ms": 280,
            },
            {
                "index": 1,
                "text": "Kenapa?",
                "control_instruction": "Use a curious tone.",
                "pause_after_ms": 0,
            },
        ],
    )
    created = test_client.post("/v1/jobs", headers=HEADERS, json=expressive)
    assert created.status_code == 202
    result = wait_for_terminal(test_client, "job-segment-sim-001")
    assert result["status"] == "succeeded"
    assert [segment["status"] for segment in result["segments"]] == [
        "succeeded",
        "succeeded",
    ]
    assert result["output_path"] is None

    retried = test_client.post(
        "/v1/jobs/job-segment-sim-001/segments/1/retry", headers=HEADERS
    )
    assert retried.status_code == 202
    retry_result = wait_for_terminal(test_client, "job-segment-sim-001")
    assert retry_result["status"] == "succeeded"
    assert retry_result["segments"][1]["status"] == "succeeded"


def test_segmented_synthesis_merges_pcm_and_retries_only_selected_segment(tmp_path: Path):
    settings = Settings(
        mode="voxcpm2",
        api_key=API_KEY,
        data_dir=tmp_path / "worker",
        model_dir=tmp_path / "models",
        cache_dir=tmp_path / "cache",
        references_dir=tmp_path / "references",
        outputs_dir=tmp_path / "outputs",
        simulation_delay_ms=0,
    )
    for directory in [
        settings.data_dir,
        settings.references_dir,
        settings.outputs_dir,
    ]:
        directory.mkdir(parents=True, exist_ok=True)
    reference = settings.references_dir / "voice.wav"
    reference.write_bytes(b"RIFF-reference")

    class FakeRuntime:
        def __init__(self):
            self.calls: list[SynthesisRequest] = []

        def generate(self, request, output_path, cancelled):
            assert not cancelled()
            assert request.reference_path == str(reference)
            self.calls.append(request)
            amplitude = 1000 + len(self.calls) * 100
            frames = array("h", [amplitude] * 800).tobytes()
            output_path.parent.mkdir(parents=True, exist_ok=True)
            with wave.open(str(output_path), "wb") as target:
                target.setnchannels(1)
                target.setsampwidth(2)
                target.setframerate(8000)
                target.writeframes(frames)
            return GenerationResult(output_path=output_path, audio_duration=0.1)

    runtime = FakeRuntime()
    main.settings = settings
    main.store = WorkerStore(settings.data_dir)
    main.inference_runtime = runtime
    request = SynthesisRequest(
        **payload(
            "job-segment-audio-001",
            text="[shouts] Berhenti! [laughs] Bagus.",
            mode="clone",
            reference_path=str(reference),
            segments=[
                {
                    "index": 0,
                    "text": "Berhenti!",
                    "control_instruction": "Shout with strong emphasis.",
                    "pause_after_ms": 250,
                },
                {
                    "index": 1,
                    "text": "[laughing] Bagus.",
                    "pause_after_ms": 0,
                },
            ],
        )
    )
    main.store.create(request)
    main.synthesize(request.job_id, request)

    completed = main.store.get(request.job_id)
    assert completed is not None
    assert completed.status == "succeeded"
    assert [segment.status for segment in completed.segments] == [
        "succeeded",
        "succeeded",
    ]
    assert [call.control_instruction for call in runtime.calls] == [
        "Shout with strong emphasis.",
        None,
    ]
    assert len({call.reference_path for call in runtime.calls}) == 1
    assert completed.audio_duration == pytest.approx(0.45)
    with wave.open(completed.output_path, "rb") as merged:
        assert merged.getframerate() == 8000
        assert merged.getnframes() == 3600

    main.store.begin_segment_retry(request.job_id, 1)
    main.synthesize(request.job_id, request, retry_index=1)
    retried = main.store.get(request.job_id)
    assert retried is not None and retried.status == "succeeded"
    assert len(runtime.calls) == 3
    assert runtime.calls[-1].text == "[laughing] Bagus."
