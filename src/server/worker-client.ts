import { serverConfig, validateServerConfiguration } from "./config";
import type { WorkerJobResponse } from "./contracts";
import { ApiError } from "./http";

async function callWorker(path: string, init?: RequestInit): Promise<unknown> {
  const configurationErrors = validateServerConfiguration();
  if (configurationErrors.length) throw new ApiError(503, configurationErrors[0]);
  let response: Response;
  try {
    response = await fetch(`${serverConfig.workerUrl}${path}`, {
      ...init,
      cache: "no-store",
      headers: { "content-type": "application/json", "x-worker-key": serverConfig.workerApiKey, ...init?.headers },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new ApiError(503, "Local worker is unreachable.");
  }
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
  if (data.output_path !== null || data.audio_duration !== null) throw new ApiError(502, "Simulation worker unexpectedly returned an audio output.");
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
