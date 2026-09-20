from __future__ import annotations

import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from worker.app import main
from worker.app.config import Settings

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
