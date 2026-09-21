import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiStudioService } from "../src/lib/api-service.ts";

const requestBody = {
  text: "Naskah dari adapter API.",
  mode: "tts",
  voiceId: "",
  description: "",
  transcript: "",
  style: "natural",
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("API adapter maps server state and sends authenticated browser requests without a server key", async () => {
  const calls: { path: string; init?: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const path = String(input);
    calls.push({ path, init });
    if (path === "/api/v1/sessions" && init?.method === "POST")
      return json({
        session: {
          status: "ready",
          startedAt: "2026-09-21T00:00:00.000Z",
          expiresAt: "2026-09-21T01:00:00.000Z",
          endedAt: null,
          message: "Worker simulation ready.",
        },
      });
    if (path === "/api/v1/sessions")
      return json({
        session: {
          status: "off",
          startedAt: null,
          expiresAt: null,
          endedAt: null,
          message: "Off",
        },
      });
    if (path === "/api/v1/jobs" && init?.method === "POST")
      return json(
        {
          job: {
            id: "job_adapter_001",
            request: requestBody,
            voiceName: "Built-in voice contract",
            status: "queued",
            progress: 0,
            createdAt: "2026-09-21T00:00:01.000Z",
            message: "Queued",
            outputFile: null,
            audioDuration: null,
          },
        },
        202,
      );
    if (path === "/api/v1/jobs") return json({ jobs: [] });
    if (path === "/api/v1/voices")
      return json({
        voices: [
          {
            id: "voice_adapter_001",
            name: "Referensi API",
            description: "Uji",
            fileName: "voice.wav",
            createdAt: "2026-09-21T00:00:00.000Z",
          },
        ],
      });
    if (path === "/api/v1/settings")
      return json({
        settings: {
          sessionMinutes: 60,
          idleMinutes: 10,
          maximumHourlyRate: 0.8,
          gpuProfile: "rtx3090",
        },
      });
    throw new Error(`Unexpected request: ${path}`);
  };

  let unauthorized = false;
  const service = new ApiStudioService(() => {
    unauthorized = true;
  }, fetcher);
  await service.hydrate(
    JSON.stringify({ version: 1, draft: requestBody }),
  );
  assert.equal(service.getSnapshot().hydrated, true);
  assert.equal(service.getSnapshot().settings.gpuId, "3090");
  assert.equal(
    service.getSnapshot().voices.at(-1)?.audioUrl,
    "/api/v1/voices/voice_adapter_001/audio",
  );

  await service.startSession();
  assert.equal(service.getSnapshot().session.status, "ready");
  await service.generate();
  assert.equal(service.getSnapshot().jobs[0].id, "job_adapter_001");
  const createCall = calls.find(
    (call) => call.path === "/api/v1/jobs" && call.init?.method === "POST",
  );
  const headers = new Headers(createCall?.init?.headers);
  assert.equal(headers.has("x-studio-key"), false);
  assert.match(headers.get("idempotency-key") || "", /^web_[a-f0-9]{32}$/);
  assert.equal(createCall?.init?.credentials, "same-origin");
  assert.equal(unauthorized, false);
});

test("API adapter preserves the fetch receiver required by browsers", async () => {
  const observedReceivers: unknown[] = [];
  const receiverSensitiveFetch = function (this: unknown, input: string | URL | Request) {
    observedReceivers.push(this);
    const path = String(input);
    if (path === "/api/v1/sessions")
      return Promise.resolve(json({
        session: { status: "off", startedAt: null, expiresAt: null, endedAt: null, message: "Off" },
      }));
    if (path === "/api/v1/jobs") return Promise.resolve(json({ jobs: [] }));
    if (path === "/api/v1/voices") return Promise.resolve(json({ voices: [] }));
    return Promise.resolve(json({
      settings: { sessionMinutes: 60, idleMinutes: 10, maximumHourlyRate: 0.8, gpuProfile: "a5000" },
    }));
  } as typeof fetch;
  const service = new ApiStudioService(() => undefined, receiverSensitiveFetch);
  await service.hydrate(null);
  assert.ok(observedReceivers.every((receiver) => receiver === globalThis));
});

test("API adapter polls active job details until the worker result is terminal", async () => {
  const queued = {
    id: "job_polling_001",
    request: requestBody,
    voiceName: "Built-in voice contract",
    status: "queued",
    progress: 0,
    createdAt: "2026-09-21T00:00:01.000Z",
    message: "Queued",
    outputFile: null,
    audioDuration: null,
  };
  const fetcher: typeof fetch = async (input) => {
    const path = String(input);
    if (path === "/api/v1/sessions")
      return json({
        session: {
          status: "ready",
          startedAt: "2026-09-21T00:00:00.000Z",
          expiresAt: "2026-09-21T01:00:00.000Z",
          endedAt: null,
          message: "Ready",
        },
      });
    if (path === "/api/v1/jobs") return json({ jobs: [queued] });
    if (path === "/api/v1/jobs/job_polling_001")
      return json({
        job: {
          ...queued,
          status: "succeeded",
          progress: 100,
          message: "VoxCPM2 generation completed.",
          outputFile: "job_polling_001.wav",
          audioDuration: 1.25,
        },
      });
    if (path === "/api/v1/voices") return json({ voices: [] });
    if (path === "/api/v1/settings")
      return json({
        settings: {
          sessionMinutes: 60,
          idleMinutes: 10,
          maximumHourlyRate: 0.8,
          gpuProfile: "a5000",
        },
      });
    throw new Error(`Unexpected request: ${path}`);
  };
  const service = new ApiStudioService(() => undefined, fetcher);
  await service.hydrate(null);
  assert.equal(service.getSnapshot().jobs[0].status, "queued");
  service.tick();
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(service.getSnapshot().jobs[0].status, "succeeded");
  assert.equal(service.getSnapshot().jobs[0].audioUrl, "/api/v1/jobs/job_polling_001/audio");
  assert.equal(service.getSnapshot().jobs[0].audioDuration, 1.25);
});

test("API adapter returns to login when the server session expires", async () => {
  let unauthorized = false;
  const service = new ApiStudioService(
    () => {
      unauthorized = true;
    },
    async () => json({ message: "Session expired." }, 401),
  );
  await assert.rejects(() => service.hydrate(null), /Sesi masuk berakhir/);
  assert.equal(unauthorized, true);
});
