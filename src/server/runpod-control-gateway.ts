import type { RunpodCloud } from "../lib/runpod-types.ts";
import { serverConfig } from "./config.ts";
import { ApiError } from "./http.ts";

type Fetcher = typeof fetch;
type UnknownRecord = Record<string, unknown>;

export type ManagedRunpodPodStatus =
  | "PROVISIONING"
  | "STARTING"
  | "RUNNING"
  | "EXITED"
  | "ERROR"
  | "TERMINATED"
  | "UNKNOWN";

export interface ManagedRunpodPod {
  id: string;
  name: string;
  status: ManagedRunpodPodStatus;
  image: string | null;
  gpuId: string | null;
  cloud: RunpodCloud | null;
  dataCenterId: string | null;
  hourlyRate: number | null;
  actions: string[];
  locked: boolean;
}

export interface CreateRunpodPodInput {
  name: string;
  image: string;
  gpuId: string;
  cloud: RunpodCloud;
  dataCenterId: string;
  networkVolumeId: string;
  workerApiKey: string;
}

export interface RunpodControlGateway {
  listPods(): Promise<ManagedRunpodPod[]>;
  getPod(id: string): Promise<ManagedRunpodPod | null>;
  createPod(input: CreateRunpodPodInput): Promise<ManagedRunpodPod>;
  startPod(id: string): Promise<ManagedRunpodPod>;
  stopPod(id: string): Promise<ManagedRunpodPod>;
}

interface RunpodRestControlGatewayOptions {
  apiKey?: string;
  baseUrl?: string;
  writeEnabled?: boolean;
  fetcher?: Fetcher;
}

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function statusValue(value: unknown): ManagedRunpodPodStatus {
  const status = String(value).toUpperCase();
  return [
    "PROVISIONING",
    "STARTING",
    "RUNNING",
    "EXITED",
    "ERROR",
    "TERMINATED",
  ].includes(status)
    ? (status as ManagedRunpodPodStatus)
    : "UNKNOWN";
}

function normalizePod(value: unknown): ManagedRunpodPod {
  const wrapper = record(value);
  const pod = record(wrapper?.pod) ?? wrapper;
  const id = stringValue(pod?.id);
  if (!id) throw new ApiError(502, "RunPod returned a Pod without an ID.");
  const cloud = stringValue(pod?.cloud).toLowerCase();
  return {
    id,
    name: stringValue(pod?.name, "Unnamed RunPod Pod"),
    status: statusValue(pod?.status ?? pod?.desiredStatus),
    image: stringValue(pod?.imageName, stringValue(pod?.image)) || null,
    gpuId:
      stringValue(pod?.gpuTypeId, stringValue(record(pod?.gpu)?.id)) || null,
    cloud:
      cloud === "community" || cloud === "secure"
        ? (cloud as RunpodCloud)
        : null,
    dataCenterId:
      stringValue(
        pod?.dataCenterId,
        stringValue(record(pod?.dataCenter)?.id),
      ) || null,
    hourlyRate: numberValue(pod?.costPerHr),
    actions: Array.isArray(pod?.actions)
      ? pod.actions.filter((item): item is string => typeof item === "string")
      : [],
    locked: pod?.locked === true,
  };
}

function podArray(value: unknown): unknown[] {
  const pods = record(value)?.pods;
  if (!Array.isArray(pods))
    throw new ApiError(502, "RunPod returned an invalid Pods response.");
  return pods;
}

function validResourceId(id: string): boolean {
  return /^[A-Za-z0-9_-]{3,100}$/.test(id);
}

export class RunpodRestControlGateway implements RunpodControlGateway {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly writeEnabled: boolean;
  private readonly fetcher: Fetcher;

  constructor(options: RunpodRestControlGatewayOptions = {}) {
    this.apiKey = options.apiKey ?? serverConfig.runpodApiKey;
    this.baseUrl = (options.baseUrl ?? serverConfig.runpodApiBaseUrl).replace(
      /\/$/,
      "",
    );
    this.writeEnabled = options.writeEnabled ?? serverConfig.runpodWriteEnabled;
    this.fetcher = options.fetcher ?? globalThis.fetch;
  }

  private async request(
    path: string,
    method: "GET" | "POST",
    body?: unknown,
    allowNotFound = false,
  ): Promise<unknown | null> {
    if (method !== "GET" && !this.writeEnabled)
      throw new ApiError(423, "RunPod write operations are disabled.");
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("://"))
      throw new ApiError(500, "RunPod request path is invalid.");
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        method,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.apiKey}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new ApiError(502, "RunPod REST API v2 could not be reached.");
    }
    if (allowNotFound && response.status === 404) return null;
    if (response.status === 401 || response.status === 403)
      throw new ApiError(
        502,
        "RunPod rejected the configured control-plane credential.",
      );
    if (response.status === 429)
      throw new ApiError(503, "RunPod rate-limited the control-plane request.");
    if (!response.ok)
      throw new ApiError(
        502,
        `RunPod REST API v2 returned HTTP ${response.status}.`,
      );
    try {
      return await response.json();
    } catch {
      throw new ApiError(502, "RunPod returned a non-JSON response.");
    }
  }

  async listPods(): Promise<ManagedRunpodPod[]> {
    const result: ManagedRunpodPod[] = [];
    const seenCursors = new Set<string>();
    let cursor = "";
    for (let page = 0; page < 10; page += 1) {
      const search = new URLSearchParams({
        limit: "100",
        ...(cursor ? { cursor } : {}),
      });
      const payload = await this.request(`/pods?${search}`, "GET");
      result.push(...podArray(payload).map(normalizePod));
      const pagination = record(record(payload)?.pagination);
      const nextCursor = stringValue(pagination?.nextCursor);
      if (
        pagination?.hasNextPage !== true ||
        !nextCursor ||
        seenCursors.has(nextCursor)
      )
        break;
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    }
    return result;
  }

  async getPod(id: string): Promise<ManagedRunpodPod | null> {
    if (!validResourceId(id))
      throw new ApiError(422, "RunPod Pod ID is invalid.");
    const payload = await this.request(`/pods/${id}`, "GET", undefined, true);
    return payload === null ? null : normalizePod(payload);
  }

  async createPod(input: CreateRunpodPodInput): Promise<ManagedRunpodPod> {
    return normalizePod(
      await this.request("/pods", "POST", {
        name: input.name,
        image: input.image,
        gpu: { id: input.gpuId, count: 1, minCudaVersion: "12.8" },
        cloud: input.cloud.toUpperCase(),
        dataCenterIds: [input.dataCenterId],
        disk: 20,
        mounts: {
          network: [{ volumeId: input.networkVolumeId, path: "/workspace" }],
        },
        ports: ["8001/http"],
        env: {
          WORKER_API_KEY: input.workerApiKey,
          WORKER_MODE: "voxcpm2",
          WORKER_MODEL_LOCAL_ONLY: "false",
        },
        startSsh: false,
        startJupyter: false,
      }),
    );
  }

  async startPod(id: string): Promise<ManagedRunpodPod> {
    if (!validResourceId(id))
      throw new ApiError(422, "RunPod Pod ID is invalid.");
    return normalizePod(
      await this.request(`/pods/${id}/action`, "POST", { action: "start" }),
    );
  }

  async stopPod(id: string): Promise<ManagedRunpodPod> {
    if (!validResourceId(id))
      throw new ApiError(422, "RunPod Pod ID is invalid.");
    return normalizePod(
      await this.request(`/pods/${id}/action`, "POST", { action: "stop" }),
    );
  }
}

export const runpodControlGateway = new RunpodRestControlGateway();
