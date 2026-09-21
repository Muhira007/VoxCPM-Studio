import type {
  RunpodAvailability,
  RunpodCloud,
  RunpodDataCenterSummary,
  RunpodDryRunPlan,
  RunpodGpuProfile,
  RunpodOffer,
  RunpodOverview,
  RunpodPlanInput,
  RunpodPodSummary,
  RunpodProfileId,
} from "../lib/runpod-types.ts";
import { serverConfig } from "./config.ts";
import { ApiError } from "./http.ts";

const MINIMUM_CUDA_VERSION = "12.8" as const;
const PROFILE_DEFINITIONS: {
  profileId: RunpodProfileId;
  runpodId: string;
  name: string;
}[] = [
  { profileId: "a5000", runpodId: "NVIDIA RTX A5000", name: "RTX A5000" },
  {
    profileId: "3090",
    runpodId: "NVIDIA GeForce RTX 3090",
    name: "RTX 3090",
  },
  {
    profileId: "4090",
    runpodId: "NVIDIA GeForce RTX 4090",
    name: "RTX 4090",
  },
];

type Fetcher = typeof fetch;
type UnknownRecord = Record<string, unknown>;

interface RunpodClientOptions {
  apiKey?: string;
  baseUrl?: string;
  workerImage?: string;
  fetcher?: Fetcher;
}

interface RunpodOverviewOptions {
  fresh?: boolean;
}

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function textValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function availability(value: unknown): RunpodAvailability {
  return ["HIGH", "MEDIUM", "LOW", "NONE"].includes(String(value))
    ? (String(value) as RunpodAvailability)
    : "UNKNOWN";
}

function arrayAt(payload: unknown, key: string): unknown[] {
  const value = record(payload)?.[key];
  if (!Array.isArray(value))
    throw new ApiError(502, `RunPod returned an invalid ${key} response.`);
  return value;
}

function query(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

function normalizeOffer(
  raw: UnknownRecord | null,
  cloud: RunpodCloud,
): RunpodOffer {
  const price = record(raw?.price);
  const dataCenters = Array.isArray(raw?.dataCenters)
    ? raw.dataCenters.map((item) => textValue(record(item)?.id)).filter(Boolean)
    : [];
  return {
    hourlyRate: numberValue(price?.[cloud]),
    availability: availability(raw?.availability),
    dataCenters: [...new Set(dataCenters)],
  };
}

function cudaVersions(raw: UnknownRecord | null): string[] {
  if (!Array.isArray(raw?.cudaVersions)) return [];
  return raw.cudaVersions
    .map(record)
    .filter((item): item is UnknownRecord => Boolean(item?.available))
    .map((item) => textValue(item.version))
    .filter(Boolean);
}

function catalogPath(cloud: RunpodCloud): string {
  return `/catalog/gpus?${query({
    include: "AVAILABILITY",
    product: "POD",
    count: "1",
    cloud: cloud.toUpperCase(),
    minCudaVersion: MINIMUM_CUDA_VERSION,
  })}`;
}

export class RunpodClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly workerImage: string;
  private readonly fetcher: Fetcher;
  private overviewCache: { value: RunpodOverview; expiresAt: number } | null =
    null;
  private overviewRequest: Promise<RunpodOverview> | null = null;

  constructor(options: RunpodClientOptions = {}) {
    this.apiKey = options.apiKey ?? serverConfig.runpodApiKey;
    this.baseUrl = (options.baseUrl ?? serverConfig.runpodApiBaseUrl).replace(
      /\/$/,
      "",
    );
    this.workerImage = options.workerImage ?? serverConfig.runpodWorkerImage;
    this.fetcher = options.fetcher ?? globalThis.fetch;
  }

  private async get(path: string): Promise<unknown> {
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("://"))
      throw new ApiError(500, "RunPod request path is invalid.");
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new ApiError(502, "RunPod REST API v2 could not be reached.");
    }
    if (response.status === 401 || response.status === 403)
      throw new ApiError(
        502,
        "RunPod rejected the configured read-only credential.",
      );
    if (response.status === 429)
      throw new ApiError(
        503,
        "RunPod rate-limited the read-only request. Try again shortly.",
      );
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

  async listPods(): Promise<RunpodPodSummary[]> {
    const pods: RunpodPodSummary[] = [];
    const seenCursors = new Set<string>();
    let cursor = "";
    for (let page = 0; page < 10; page += 1) {
      const path = `/pods?${query({ limit: "100", ...(cursor ? { cursor } : {}) })}`;
      const payload = await this.get(path);
      for (const item of arrayAt(payload, "pods")) {
        const pod = record(item);
        const id = textValue(pod?.id);
        if (!id) continue;
        pods.push({
          id,
          name: textValue(pod?.name, "Pod tanpa nama"),
          status: textValue(
            pod?.status,
            textValue(pod?.desiredStatus, "UNKNOWN"),
          ),
          gpuTypeId: textValue(pod?.gpuTypeId) || null,
          image: textValue(pod?.imageName, textValue(pod?.image)) || null,
          hourlyRate: numberValue(pod?.costPerHr),
        });
      }
      const pagination = record(record(payload)?.pagination);
      const hasNextPage = pagination?.hasNextPage === true;
      const nextCursor = textValue(pagination?.nextCursor);
      if (!hasNextPage || !nextCursor || seenCursors.has(nextCursor)) break;
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    }
    return pods;
  }

  private async gpuCatalog(cloud: RunpodCloud): Promise<UnknownRecord[]> {
    return arrayAt(await this.get(catalogPath(cloud)), "gpus")
      .map(record)
      .filter((item): item is UnknownRecord => item !== null);
  }

  async listDataCenters(): Promise<RunpodDataCenterSummary[]> {
    const items = arrayAt(
      await this.get("/catalog/datacenters"),
      "dataCenters",
    );
    return items
      .map(record)
      .filter((item): item is UnknownRecord => item !== null)
      .map((item) => ({
        id: textValue(item.id),
        name: textValue(item.name, textValue(item.id)),
        region: textValue(item.region, "UNKNOWN"),
        networkVolumeTypes: Array.isArray(item.networkVolumeTypes)
          ? item.networkVolumeTypes
              .map((volume) =>
                typeof volume === "string"
                  ? volume
                  : textValue(
                      record(volume)?.id,
                      textValue(record(volume)?.name),
                    ),
              )
              .filter(Boolean)
          : [],
      }))
      .filter((item) => item.id);
  }

  async overview(options: RunpodOverviewOptions = {}): Promise<RunpodOverview> {
    if (
      !options.fresh &&
      this.overviewCache &&
      this.overviewCache.expiresAt > Date.now()
    )
      return this.overviewCache.value;
    if (this.overviewRequest) return this.overviewRequest;
    this.overviewRequest = this.loadOverview();
    try {
      const value = await this.overviewRequest;
      this.overviewCache = { value, expiresAt: Date.now() + 30_000 };
      return value;
    } finally {
      this.overviewRequest = null;
    }
  }

  private async loadOverview(): Promise<RunpodOverview> {
    const [pods, community, secure, dataCenters] = await Promise.all([
      this.listPods(),
      this.gpuCatalog("community"),
      this.gpuCatalog("secure"),
      this.listDataCenters(),
    ]);
    const byId = (items: UnknownRecord[]) =>
      new Map(items.map((item) => [textValue(item.id), item]));
    const communityById = byId(community);
    const secureById = byId(secure);
    const profiles: RunpodGpuProfile[] = PROFILE_DEFINITIONS.map(
      (definition) => {
        const communityItem = communityById.get(definition.runpodId) ?? null;
        const secureItem = secureById.get(definition.runpodId) ?? null;
        const primary = communityItem ?? secureItem;
        return {
          profileId: definition.profileId,
          runpodId: definition.runpodId,
          name: definition.name,
          memoryGb: numberValue(primary?.memory),
          cudaVersions: [
            ...new Set([
              ...cudaVersions(communityItem),
              ...cudaVersions(secureItem),
            ]),
          ],
          offers: {
            community: normalizeOffer(communityItem, "community"),
            secure: normalizeOffer(secureItem, "secure"),
          },
        };
      },
    );
    return {
      mode: "read-only",
      observedAt: new Date().toISOString(),
      source: "RunPod REST API v2",
      minimumCudaVersion: MINIMUM_CUDA_VERSION,
      writesEnabled: false,
      mutationAttempted: false,
      inventory: { podCount: pods.length, pods },
      catalog: {
        gpuTypeCount: Math.max(community.length, secure.length),
        dataCenterCount: dataCenters.length,
        profiles,
        dataCenters,
      },
    };
  }

  plan(overview: RunpodOverview, input: RunpodPlanInput): RunpodDryRunPlan {
    const profile = overview.catalog.profiles.find(
      (item) => item.profileId === input.profileId,
    );
    if (!profile)
      throw new ApiError(
        422,
        "The selected RunPod GPU profile is unavailable.",
      );
    const offer = profile.offers[input.cloud];
    const rateWithinLimit =
      offer.hourlyRate !== null && offer.hourlyRate <= input.maximumHourlyRate;
    const gpuAvailable =
      offer.availability !== "NONE" &&
      offer.availability !== "UNKNOWN" &&
      offer.dataCenters.length > 0;
    const blockers: string[] = [];
    if (!gpuAvailable)
      blockers.push(
        "Profil GPU tidak tersedia pada cloud yang dipilih saat katalog dibaca.",
      );
    if (offer.hourlyRate === null)
      blockers.push("Tarif per jam tidak tersedia pada katalog RunPod.");
    else if (!rateWithinLimit)
      blockers.push("Tarif aktual melewati batas harga per jam di Pengaturan.");
    if (overview.inventory.podCount > 0)
      blockers.push(
        "Inventaris berisi Pod yang harus direkonsiliasi sebelum membuat sesi baru.",
      );
    blockers.push(
      "Network Volume Standard 30 GB sudah dipilih; volume dan data center aktual belum dikonfigurasi.",
    );
    blockers.push(
      "Client RunPod hanya mengizinkan operasi baca; operasi create sengaja dinonaktifkan.",
    );
    return {
      dryRun: true,
      resourceCreated: false,
      mutationAttempted: false,
      readyForPaidCreate: false,
      profileId: input.profileId,
      runpodGpuId: profile.runpodId,
      cloud: input.cloud,
      durationMinutes: input.durationMinutes,
      maximumHourlyRate: input.maximumHourlyRate,
      hourlyRate: offer.hourlyRate,
      estimatedComputeCost:
        offer.hourlyRate === null
          ? null
          : Number(
              ((offer.hourlyRate * input.durationMinutes) / 60).toFixed(4),
            ),
      availability: offer.availability,
      dataCenters: offer.dataCenters,
      image: this.workerImage,
      containerDiskGb: 20,
      persistentVolumeGb: 30,
      checks: {
        writeOperationsDisabled: true,
        immutableImage: /@sha256:[a-f0-9]{64}$/.test(this.workerImage),
        noExistingPods: overview.inventory.podCount === 0,
        rateWithinLimit,
        gpuAvailable,
        storageSelected: true,
      },
      blockers,
      notes: [
        "Estimasi hanya menghitung GPU dan belum memasukkan storage, startup, idle, retry, atau pajak.",
        "Saldo akun tidak tersedia melalui endpoint baca yang digunakan panel ini.",
      ],
    };
  }
}

export const runpodClient = new RunpodClient();
