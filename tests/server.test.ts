import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { analyzePcmAudio } from "../src/lib/audio-analysis.ts";
import type { ServerJob, ServerVoice } from "../src/server/contracts.ts";
import { AppStore } from "../src/server/store.ts";
import { parseSynthesisRequest, requestHash } from "../src/server/validation.ts";

const request = {
  text: "Naskah pengujian backend.",
  mode: "tts" as const,
  voiceId: "",
  description: "",
  transcript: "",
  style: "natural" as const,
};

async function temporaryStore() {
  const directory = await mkdtemp(join(tmpdir(), "voxcpm-store-test-"));
  return { directory, store: new AppStore(directory) };
}

async function removeTemporary(directory: string) {
  const root = resolve(tmpdir());
  const target = resolve(directory);
  assert.ok(target.startsWith(root) && target.includes("voxcpm-store-test-"));
  await rm(target, { recursive: true, force: true });
}

function job(id: string): ServerJob {
  const now = new Date().toISOString();
  return { id, idempotencyKey: `key_${id}`, requestHash: requestHash(request), request, voiceName: "Built-in", status: "queued", progress: 0, createdAt: now, updatedAt: now, message: "Queued", outputFile: null, audioDuration: null, segments: [] };
}

test("application store persists sessions, jobs, and voice metadata atomically", async () => {
  const { directory, store } = await temporaryStore();
  try {
    await store.probe();
    await store.replaceSession({ status: "ready", startedAt: "2026-09-21T00:00:00.000Z", expiresAt: "2026-09-21T01:00:00.000Z", endedAt: null, message: "Ready", mode: "worker-simulation" });
    await Promise.all([store.addJob(job("job_backend_0001")), store.addJob(job("job_backend_0002"))]);
    await store.mutate((state) => { state.settings = { sessionMinutes: 120, idleMinutes: 15, maximumHourlyRate: 0.5, gpuProfile: "rtx3090" }; });
    const analysis = analyzePcmAudio({ channelData: [new Float32Array(20 * 24_000).fill(0.3)], sampleRate: 24_000, format: "wav", bitDepth: 16, analyzedAt: 1 });
    const voice: ServerVoice = { id: "voice_backend_01", name: "Referensi", description: "", fileName: "voice.wav", storageName: "12345678-abcd.wav", contentType: "audio/wav", size: 8, analysis, createdAt: "2026-09-21T00:00:00.000Z" };
    await store.addVoice(voice);
    const reopened = new AppStore(directory);
    const state = await reopened.read();
    assert.equal(state.session.status, "ready");
    assert.equal(state.jobs.length, 2);
    assert.equal(state.voices[0].name, "Referensi");
    assert.equal(state.voices[0].analysis?.status, "pass");
    assert.equal(state.settings.sessionMinutes, 120);
    const disk = JSON.parse(await readFile(join(directory, "studio-state.json"), "utf8"));
    assert.equal(disk.version, 1);
  } finally { await removeTemporary(directory); }
});

test("application store shares first-time initialization across concurrent API reads", async () => {
  const { directory, store } = await temporaryStore();
  try {
    const states = await Promise.all(Array.from({ length: 8 }, () => store.read()));
    assert.ok(states.every((state) => state.version === 1));
    const files = await readdir(directory);
    assert.deepEqual(files.sort(), ["outputs", "references", "studio-state.json"]);
  } finally { await removeTemporary(directory); }
});

test("store contains reference paths and caps history at 100 jobs", async () => {
  const { directory, store } = await temporaryStore();
  try {
    assert.throws(() => store.referencePath("../outside.wav"), /Invalid/);
    assert.ok(store.referencePath("12345678-abcd.wav").startsWith(resolve(store.referencesDir)));
    assert.throws(() => store.outputPath("../outside.wav"), /Invalid/);
    const outputName = await store.saveOutput("job_backend_output1", new Uint8Array([82, 73, 70, 70]));
    assert.equal(outputName, "job_backend_output1.wav");
    assert.deepEqual(await readFile(store.outputPath(outputName)), Buffer.from([82, 73, 70, 70]));
    await store.clearOutputs();
    await assert.rejects(readFile(store.outputPath(outputName)), /ENOENT/);
    for (let index = 0; index < 105; index++) await store.addJob(job(`job_backend_${String(index).padStart(4, "0")}`));
    assert.equal((await store.read()).jobs.length, 100);
  } finally { await removeTemporary(directory); }
});

test("server request validation enforces mode-specific contracts", () => {
  assert.deepEqual(parseSynthesisRequest(request), request);
  assert.equal(requestHash(request).length, 64);
  assert.throws(() => parseSynthesisRequest({ ...request, text: "" }), /text/);
  assert.throws(() => parseSynthesisRequest({ ...request, mode: "design" }), /description/);
  assert.throws(() => parseSynthesisRequest({ ...request, mode: "clone" }), /voiceId/);
  assert.throws(() => parseSynthesisRequest({ ...request, mode: "hifi", voiceId: "voice_backend_01" }), /transcript/);
  assert.throws(() => parseSynthesisRequest({ ...request, text: "[sad] Naskah." }), /tidak didukung/);
  assert.equal(parseSynthesisRequest({ ...request, text: "[excited] Naskah." }).text, "[excited] Naskah.");
  assert.throws(
    () =>
      parseSynthesisRequest({
        ...request,
        text: "[excited] Naskah.",
        mode: "hifi",
        voiceId: "voice_backend_01",
        transcript: "Referensi.",
      }),
    /ignores expression control/,
  );
  assert.throws(() => parseSynthesisRequest({ ...request, unsupported: true }), /unsupported/);
});

test("saving a retried job atomically replaces its previous WAV", async () => {
  const { directory, store } = await temporaryStore();
  try {
    const name = await store.saveOutput("job_backend_retry1", new Uint8Array([1, 2]));
    await store.saveOutput("job_backend_retry1", new Uint8Array([3, 4, 5]));
    assert.deepEqual(await readFile(store.outputPath(name)), Buffer.from([3, 4, 5]));
  } finally {
    await removeTemporary(directory);
  }
});
