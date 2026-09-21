import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { serverConfig, validateServerConfiguration } from "./config";
import type { WorkerJobResponse } from "./contracts";
import { ApiError } from "./http";

const MAX_WORKER_AUDIO_BYTES = 100 * 1024 * 1024;

async function workerFetch(path: string, init?: RequestInit, timeout = 5000): Promise<Response> {
  const configurationErrors = validateServerConfiguration();
  if (configurationErrors.length) throw new ApiError(503, configurationErrors[0]);
  const headers = new Headers(init?.headers);
  headers.set("x-worker-key", serverConfig.workerApiKey);
  let response: Response;
  try {
    response = await fetch(`${serverConfig.workerUrl}${path}`, {
      ...init,
      cache: "no-store",
      headers,
      signal: AbortSignal.timeout(timeout),
    });
  } catch {
    throw new ApiError(503, "Local worker is unreachable.");
  }
  return response;
}

async function callWorker(path: string, init?: RequestInit): Promise<unknown> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await workerFetch(path, { ...init, headers });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload && typeof payload === "object" && "detail" in payload ? String(payload.detail) : "Worker request failed.";
    throw new ApiError(response.status, detail);
  }
  return payload;
}

function workerJob(value: unknown): WorkerJobResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(502, "Worker returned an invalid job response.");
  const data = value as Record<string, unknown>;
  const statuses = new Set(["queued", "running", "succeeded", "failed", "cancelled"]);
  if (typeof data.id !== "string" || typeof data.status !== "string" || !statuses.has(data.status) || typeof data.progress !== "number" || data.progress < 0 || data.progress > 100) throw new ApiError(502, "Worker returned an invalid job response.");
  if (data.output_path !== null && typeof data.output_path !== "string") throw new ApiError(502, "Worker returned an invalid output path.");
  if (data.audio_duration !== null && (typeof data.audio_duration !== "number" || data.audio_duration <= 0)) throw new ApiError(502, "Worker returned an invalid audio duration.");
  if ((data.output_path === null) !== (data.audio_duration === null)) throw new ApiError(502, "Worker returned incomplete audio metadata.");
  return data as unknown as WorkerJobResponse;
}

export async function workerReady(): Promise<boolean> {
  const result = await callWorker("/v1/ready");
  return Boolean(result && typeof result === "object" && "ready" in result && result.ready);
}

export async function submitWorkerJob(payload: Record<string, unknown>): Promise<WorkerJobResponse> {
  return workerJob(await callWorker("/v1/jobs", { method: "POST", body: JSON.stringify(payload) }));
}

export async function readWorkerJob(id: string): Promise<WorkerJobResponse> {
  return workerJob(await callWorker(`/v1/jobs/${encodeURIComponent(id)}`));
}

export async function cancelWorkerJob(id: string): Promise<WorkerJobResponse> {
  return workerJob(await callWorker(`/v1/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST", body: "{}" }));
}

export async function uploadWorkerReference(id: string, sourcePath: string): Promise<string> {
  const audio = await readFile(sourcePath);
  if (audio.byteLength < 1 || audio.byteLength > 20 * 1024 * 1024) throw new ApiError(422, "Reference audio must be between 1 byte and 20 MB.");
  const extension = extname(sourcePath).toLowerCase();
  if (!/^\.[a-z0-9]{2,5}$/.test(extension)) throw new ApiError(422, "Reference audio extension is invalid.");
  const response = await workerFetch(
    `/v1/references/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      headers: { "content-type": "application/octet-stream", "x-reference-extension": extension },
      body: new Uint8Array(audio),
    },
    30_000,
  );
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload && typeof payload === "object" && "detail" in payload ? String(payload.detail) : "Worker reference upload failed.";
    throw new ApiError(response.status, detail);
  }
  if (!payload || typeof payload !== "object" || !("path" in payload) || typeof payload.path !== "string") throw new ApiError(502, "Worker returned an invalid reference path.");
  return payload.path;
}

export async function downloadWorkerAudio(id: string): Promise<Uint8Array> {
  const response = await workerFetch(`/v1/jobs/${encodeURIComponent(id)}/audio`, undefined, 60_000);
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const detail = payload && typeof payload === "object" && "detail" in payload ? String(payload.detail) : "Worker audio download failed.";
    throw new ApiError(response.status, detail);
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("audio/")) throw new ApiError(502, "Worker returned a non-audio result.");
  const declaredLength = Number(response.headers.get("content-length") || "0");
  if (declaredLength > MAX_WORKER_AUDIO_BYTES) throw new ApiError(502, "Worker audio exceeded the 100 MB limit.");
  const audio = new Uint8Array(await response.arrayBuffer());
  if (audio.byteLength < 1 || audio.byteLength > MAX_WORKER_AUDIO_BYTES) throw new ApiError(502, "Worker returned an empty or oversized audio result.");
  return audio;
}
