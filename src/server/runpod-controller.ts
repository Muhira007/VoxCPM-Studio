import { createHash, randomUUID } from "node:crypto";
import type {
  RunpodControlOperation,
  RunpodControlPhase,
  RunpodControlState,
  RunpodControlStatus,
  RunpodOperationKind,
} from "../lib/runpod-control-types.ts";
import type {
  RunpodCloud,
  RunpodOverview,
  RunpodProfileId,
} from "../lib/runpod-types.ts";
import { serverConfig } from "./config.ts";
import { ApiError } from "./http.ts";
import { runpodClient } from "./runpod-client.ts";
import {
  type ManagedRunpodPod,
  type RunpodControlGateway,
  runpodControlGateway,
} from "./runpod-control-gateway.ts";
import {
  type RunpodControlStore,
  emptyRunpodControlSession,
  runpodControlStore,
} from "./runpod-control-store.ts";

const MANAGED_POD_PREFIX = "voxcpm-studio-";
const MAX_STOP_FAILURES = 3;
const LEASE_MILLISECONDS = 120_000;

const RUNPOD_GPU_IDS: Record<RunpodProfileId, string> = {
  a5000: "NVIDIA RTX A5000",
  "3090": "NVIDIA GeForce RTX 3090",
  "4090": "NVIDIA GeForce RTX 4090",
};

export interface RunpodControllerConfig {
  apiKey: string;
  writeEnabled: boolean;
  workerImage: string;
  workerApiKey: string;
  cloud: RunpodCloud;
  dataCenterId: string;
  networkVolumeId: string;
  hardCostLimitUsd: number;
  maximumSessionMinutes: number;
}

export interface RunpodStartInput {
  operationId: string;
  profileId: RunpodProfileId;
  durationMinutes: number;
  maximumHourlyRate: number;
}

export interface RunpodStopInput {
  operationId: string;
  kind?: "stop" | "watchdog-stop";
}

interface CatalogReader {
  overview(options?: { fresh?: boolean }): Promise<RunpodOverview>;
}

interface RunpodControllerDependencies {
  store?: RunpodControlStore;
  gateway?: RunpodControlGateway;
  catalog?: CatalogReader;
  config?: RunpodControllerConfig;
  now?: () => Date;
  workerProbe?: (podId: string) => Promise<boolean>;
}

function defaultConfig(): RunpodControllerConfig {
  const cloud = serverConfig.runpodCloud.toLowerCase();
  return {
    apiKey: serverConfig.runpodApiKey,
    writeEnabled: serverConfig.runpodWriteEnabled,
    workerImage: serverConfig.runpodWorkerImage,
    workerApiKey: serverConfig.workerApiKey,
    cloud: cloud as RunpodCloud,
    dataCenterId: serverConfig.runpodDataCenterId,
    networkVolumeId: serverConfig.runpodNetworkVolumeId,
    hardCostLimitUsd: serverConfig.runpodHardCostLimitUsd,
    maximumSessionMinutes: serverConfig.runpodMaxSessionMinutes,
  };
}

function requestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function validOperationId(value: string): boolean {
  return /^[A-Za-z0-9_-]{16,100}$/.test(value);
}

function operationError(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "The RunPod control operation failed unexpectedly.";
}

function isStopped(pod: ManagedRunpodPod): boolean {
  return pod.status === "EXITED" || pod.status === "TERMINATED";
}

function infrastructurePhase(pod: ManagedRunpodPod): RunpodControlPhase {
  if (pod.status === "PROVISIONING") return "provisioning";
  if (pod.status === "STARTING") return "starting";
  if (pod.status === "RUNNING") return "loading_model";
  if (isStopped(pod)) return "stopped";
  return "error";
}

function upsertOperation(
  state: RunpodControlState,
  operation: RunpodControlOperation,
) {
  const index = state.operations.findIndex((item) => item.id === operation.id);
  if (index === -1) state.operations.push(operation);
  else state.operations[index] = operation;
}

async function defaultWorkerProbe(podId: string): Promise<boolean> {
  if (!/^[A-Za-z0-9-]{3,100}$/.test(podId)) return false;
  try {
    const response = await fetch(
      `https://${podId}-8001.proxy.runpod.net/v1/ready`,
      {
        method: "GET",
        headers: { "x-worker-key": serverConfig.workerApiKey },
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok) return false;
    const payload = (await response.json()) as { ready?: unknown };
    return payload.ready === true;
  } catch {
    return false;
  }
}

export class RunpodController {
  private readonly store: RunpodControlStore;
  private readonly gateway: RunpodControlGateway;
  private readonly catalog: CatalogReader;
  private readonly config: RunpodControllerConfig;
  private readonly now: () => Date;
  private readonly workerProbe: (podId: string) => Promise<boolean>;

  constructor(dependencies: RunpodControllerDependencies = {}) {
    this.store = dependencies.store ?? runpodControlStore;
    this.gateway = dependencies.gateway ?? runpodControlGateway;
    this.catalog = dependencies.catalog ?? runpodClient;
    this.config = dependencies.config ?? defaultConfig();
    this.now = dependencies.now ?? (() => new Date());
    this.workerProbe = dependencies.workerProbe ?? defaultWorkerProbe;
  }

  private writeConfigurationErrors(): string[] {
    const errors: string[] = [];
    if (!this.config.writeEnabled)
      errors.push("RUNPOD_WRITE_ENABLED is false.");
    if (this.config.apiKey.length < 32)
      errors.push("RUNPOD_API_KEY is not configured for the control plane.");
    if (this.config.workerApiKey.length < 32)
      errors.push("WORKER_API_KEY is not configured for the GPU worker.");
    if (!["community", "secure"].includes(this.config.cloud))
      errors.push("RUNPOD_CLOUD must be SECURE or COMMUNITY.");
    if (!/@sha256:[a-f0-9]{64}$/.test(this.config.workerImage))
      errors.push("RUNPOD_WORKER_IMAGE must use an immutable sha256 digest.");
    if (!/^[A-Za-z0-9-]{2,50}$/.test(this.config.dataCenterId))
      errors.push("RUNPOD_DATA_CENTER_ID is not configured.");
    if (!/^[A-Za-z0-9_-]{3,100}$/.test(this.config.networkVolumeId))
      errors.push("RUNPOD_NETWORK_VOLUME_ID is not configured.");
    if (
      !Number.isFinite(this.config.hardCostLimitUsd) ||
      this.config.hardCostLimitUsd <= 0 ||
      this.config.hardCostLimitUsd > 25
    )
      errors.push("The RunPod hard cost limit is invalid.");
    if (![30, 60, 120, 240].includes(this.config.maximumSessionMinutes))
      errors.push("The RunPod maximum session duration is invalid.");
    return errors;
  }

  private assertWriteConfiguration() {
    const errors = this.writeConfigurationErrors();
    if (errors.length) throw new ApiError(423, errors[0]);
  }

  async status(): Promise<RunpodControlStatus> {
    const state = await this.store.read();
    const blockers = this.writeConfigurationErrors();
    blockers.push(
      "Pengawas deadline belum dideploy pada layanan cloud yang selalu aktif.",
    );
    blockers.push("Siklus GPU nyata belum diverifikasi dengan saldo RunPod.");
    return {
      writeEnabled: this.config.writeEnabled,
      liveMutationAttempted: state.operations.some((operation) =>
        Boolean(operation.mutationAttemptedAt),
      ),
      phase: state.session.phase,
      session: state.session,
      storage: {
        strategy: "network-volume",
        tier: "standard",
        sizeGb: 30,
        mountPath: "/workspace",
        estimatedMonthlyUsd: 2.1,
        volumeConfigured: Boolean(this.config.networkVolumeId),
        dataCenterConfigured: Boolean(this.config.dataCenterId),
      },
      limits: {
        maximumSessionMinutes: Number.isFinite(
          this.config.maximumSessionMinutes,
        )
          ? this.config.maximumSessionMinutes
          : 240,
        hardCostLimitUsd: Number.isFinite(this.config.hardCostLimitUsd)
          ? this.config.hardCostLimitUsd
          : 1,
      },
      safeguards: {
        immutableImage: /@sha256:[a-f0-9]{64}$/.test(this.config.workerImage),
        idempotency: true,
        persistedLease: true,
        crossProcessFileLock: true,
        schedulerCommandReady: true,
        singleReplicaRequired: true,
        reconcileBeforeCreate: true,
        hardDeadline: true,
        verifiedStopRequired: true,
        terminateImplemented: false,
        cloudWatchdogDeployed: false,
      },
      blockers,
    };
  }

  private async acquireLease(owner: string) {
    const now = this.now().getTime();
    await this.store.mutate((state) => {
      const expiry = state.lease
        ? Date.parse(state.lease.expiresAt)
        : Number.NaN;
      if (state.lease && Number.isFinite(expiry) && expiry > now)
        throw new ApiError(
          409,
          "Another RunPod control operation currently owns the lease.",
        );
      state.lease = {
        owner,
        expiresAt: new Date(now + LEASE_MILLISECONDS).toISOString(),
      };
    });
  }

  private async releaseLease(owner: string) {
    await this.store.mutate((state) => {
      if (state.lease?.owner === owner) state.lease = null;
    });
  }

  private async withLease<T>(operation: () => Promise<T>): Promise<T> {
    const owner = randomUUID();
    await this.acquireLease(owner);
    try {
      return await operation();
    } finally {
      await this.releaseLease(owner);
    }
  }

  private matchingOperation(
    state: RunpodControlState,
    id: string,
    kind: RunpodOperationKind,
    hash: string,
  ): RunpodControlOperation | null {
    const operation = state.operations.find((item) => item.id === id) ?? null;
    if (
      operation &&
      (operation.kind !== kind || operation.requestHash !== hash)
    )
      throw new ApiError(
        409,
        "The idempotency key was already used for different RunPod input.",
      );
    return operation;
  }

  private validateStartInput(input: RunpodStartInput) {
    if (!validOperationId(input.operationId))
      throw new ApiError(422, "The RunPod idempotency key is invalid.");
    if (!Object.hasOwn(RUNPOD_GPU_IDS, input.profileId))
      throw new ApiError(422, "The RunPod GPU profile is invalid.");
    if (
      ![30, 60, 120, 240].includes(input.durationMinutes) ||
      input.durationMinutes > this.config.maximumSessionMinutes
    )
      throw new ApiError(422, "The RunPod session duration is invalid.");
    if (
      !Number.isFinite(input.maximumHourlyRate) ||
      input.maximumHourlyRate < 0.01 ||
      input.maximumHourlyRate > 10
    )
      throw new ApiError(422, "The RunPod hourly rate limit is invalid.");
  }

  async start(input: RunpodStartInput): Promise<RunpodControlState> {
    this.assertWriteConfiguration();
    this.validateStartInput(input);
    const hash = requestHash({
      profileId: input.profileId,
      durationMinutes: input.durationMinutes,
      maximumHourlyRate: input.maximumHourlyRate,
      cloud: this.config.cloud,
      dataCenterId: this.config.dataCenterId,
      networkVolumeId: this.config.networkVolumeId,
      image: this.config.workerImage,
    });
    return this.withLease(async () => {
      const initial = await this.store.read();
      const existingOperation = this.matchingOperation(
        initial,
        input.operationId,
        "start",
        hash,
      );
      if (existingOperation?.status === "succeeded") return initial;

      const overview = await this.catalog.overview({ fresh: true });
      const profile = overview.catalog.profiles.find(
        (item) => item.profileId === input.profileId,
      );
      if (!profile)
        throw new ApiError(422, "The selected RunPod GPU is unavailable.");
      const offer = profile.offers[this.config.cloud];
      if (
        offer.availability === "NONE" ||
        offer.availability === "UNKNOWN" ||
        !offer.dataCenters.includes(this.config.dataCenterId)
      )
        throw new ApiError(
          409,
          "The selected GPU is unavailable in the configured data center.",
        );
      if (offer.hourlyRate === null)
        throw new ApiError(409, "RunPod did not publish an hourly rate.");
      if (offer.hourlyRate > input.maximumHourlyRate)
        throw new ApiError(409, "The live RunPod rate exceeds the UI limit.");
      const estimatedComputeCost =
        (offer.hourlyRate * input.durationMinutes) / 60;
      if (estimatedComputeCost > this.config.hardCostLimitUsd)
        throw new ApiError(
          409,
          "The estimated compute cost exceeds the hard cost limit.",
        );

      const pods = await this.gateway.listPods();
      const managed = pods.filter((pod) =>
        pod.name.startsWith(MANAGED_POD_PREFIX),
      );
      const unmanaged = pods.filter(
        (pod) => !pod.name.startsWith(MANAGED_POD_PREFIX),
      );
      if (unmanaged.length)
        throw new ApiError(
          409,
          "Unmanaged RunPod Pods must be reviewed before starting a session.",
        );
      if (managed.length > 1)
        throw new ApiError(
          409,
          "Multiple managed RunPod Pods require manual reconciliation.",
        );
      let pod = managed[0] ?? null;
      if (pod && pod.image !== this.config.workerImage)
        throw new ApiError(
          409,
          "The existing managed Pod uses a different immutable image.",
        );
      if (pod?.status === "TERMINATED" || pod?.status === "ERROR")
        throw new ApiError(
          409,
          "The existing managed Pod cannot be resumed safely.",
        );
      if (!pod && existingOperation?.mutationAttemptedAt)
        throw new ApiError(
          409,
          "A previous create outcome is still unknown; reconcile the deterministic Pod name before retrying.",
        );

      const now = this.now();
      const podName = pod?.name ?? `${MANAGED_POD_PREFIX}${hash.slice(0, 12)}`;
      const operation: RunpodControlOperation = {
        id: input.operationId,
        kind: "start",
        requestHash: hash,
        status: "pending",
        createdAt: existingOperation?.createdAt ?? now.toISOString(),
        updatedAt: now.toISOString(),
        mutationAttemptedAt: existingOperation?.mutationAttemptedAt ?? null,
        error: null,
      };
      await this.store.mutate((state) => {
        upsertOperation(state, operation);
        state.session = {
          ...emptyRunpodControlSession(),
          phase: pod ? infrastructurePhase(pod) : "planned",
          podId: pod?.id ?? null,
          podName,
          operationId: input.operationId,
          profileId: input.profileId,
          cloud: this.config.cloud,
          dataCenterId: this.config.dataCenterId,
          networkVolumeId: this.config.networkVolumeId,
          hourlyRate: offer.hourlyRate,
          startedAt: now.toISOString(),
          hardDeadline: new Date(
            now.getTime() + input.durationMinutes * 60_000,
          ).toISOString(),
          message: pod
            ? "Existing managed RunPod Pod was reconciled."
            : "RunPod Pod creation is planned.",
        };
      });

      try {
        if (!pod) {
          await this.markMutationAttempted(input.operationId);
          pod = await this.gateway.createPod({
            name: podName,
            image: this.config.workerImage,
            gpuId: RUNPOD_GPU_IDS[input.profileId],
            cloud: this.config.cloud,
            dataCenterId: this.config.dataCenterId,
            networkVolumeId: this.config.networkVolumeId,
            workerApiKey: this.config.workerApiKey,
          });
        } else if (pod.status === "EXITED") {
          await this.markMutationAttempted(input.operationId);
          pod = await this.gateway.startPod(pod.id);
        }
        const finalPod = pod;
        await this.store.mutate((state) => {
          const current = state.operations.find(
            (item) => item.id === input.operationId,
          );
          if (current) {
            current.status = "succeeded";
            current.updatedAt = this.now().toISOString();
            current.error = null;
          }
          state.session.podId = finalPod.id;
          state.session.podName = finalPod.name;
          state.session.phase = infrastructurePhase(finalPod);
          state.session.lastVerifiedAt = this.now().toISOString();
          state.session.message =
            finalPod.status === "RUNNING"
              ? "RunPod is running; worker readiness is still being checked."
              : `RunPod reported ${finalPod.status}.`;
        });
        return await this.store.read();
      } catch (error) {
        await this.recordFailure(input.operationId, error, false);
        throw error;
      }
    });
  }

  private async findSessionPod(
    state: RunpodControlState,
  ): Promise<ManagedRunpodPod | null> {
    if (state.session.podId) {
      const pod = await this.gateway.getPod(state.session.podId);
      if (pod) return pod;
    }
    const managed = (await this.gateway.listPods()).filter((pod) =>
      pod.name.startsWith(MANAGED_POD_PREFIX),
    );
    if (managed.length > 1)
      throw new ApiError(
        409,
        "Multiple managed RunPod Pods require manual reconciliation.",
      );
    if (state.session.podName)
      return managed.find((pod) => pod.name === state.session.podName) ?? null;
    return managed[0] ?? null;
  }

  async reconcile(): Promise<RunpodControlState> {
    const initial = await this.store.read();
    const pod = await this.findSessionPod(initial);
    if (!pod) {
      if (initial.session.phase === "planned") return initial;
      await this.store.mutate((state) => {
        state.session = emptyRunpodControlSession();
        state.session.lastVerifiedAt = this.now().toISOString();
      });
      return await this.store.read();
    }
    let workerReady = false;
    if (pod.status === "RUNNING" && initial.session.phase !== "stopping")
      workerReady = await this.workerProbe(pod.id);
    await this.store.mutate((state) => {
      state.session.podId = pod.id;
      state.session.podName = pod.name;
      state.session.lastVerifiedAt = this.now().toISOString();
      state.session.workerReady = workerReady;
      if (isStopped(pod)) {
        state.session.phase = "stopped";
        state.session.stopConfirmedAt = this.now().toISOString();
        state.session.nextRetryAt = null;
        state.session.message = `RunPod stop was verified as ${pod.status}.`;
        for (const operation of state.operations) {
          if (
            operation.status === "pending" &&
            ["stop", "watchdog-stop"].includes(operation.kind)
          ) {
            operation.status = "succeeded";
            operation.updatedAt = this.now().toISOString();
            operation.error = null;
          }
        }
      } else if (pod.status === "RUNNING") {
        state.session.phase =
          state.session.phase === "stopping"
            ? "stopping"
            : workerReady
              ? "ready"
              : "loading_model";
        state.session.message =
          state.session.phase === "stopping"
            ? "Waiting for RunPod to confirm the stop."
            : workerReady
              ? "RunPod and the VoxCPM2 worker are ready."
              : "RunPod is running; the worker is still loading.";
      } else if (state.session.phase === "stopping") {
        state.session.message = "Waiting for RunPod to confirm the stop.";
      } else {
        state.session.phase = infrastructurePhase(pod);
        state.session.message = `RunPod reported ${pod.status}.`;
      }
    });
    return await this.store.read();
  }

  private async recordFailure(
    operationId: string,
    error: unknown,
    scheduleRetry: boolean,
  ) {
    const message = operationError(error);
    await this.store.mutate((state) => {
      const operation = state.operations.find(
        (item) => item.id === operationId,
      );
      if (operation) {
        operation.status = "failed";
        operation.updatedAt = this.now().toISOString();
        operation.error = message;
      }
      state.session.phase = "error";
      state.session.message = message;
      if (scheduleRetry) {
        state.session.retryCount += 1;
        const retry = state.session.retryCount;
        state.session.nextRetryAt =
          retry >= MAX_STOP_FAILURES
            ? null
            : new Date(
                this.now().getTime() + 30_000 * 2 ** (retry - 1),
              ).toISOString();
      }
    });
  }

  private async markMutationAttempted(operationId: string) {
    await this.store.mutate((state) => {
      const operation = state.operations.find(
        (item) => item.id === operationId,
      );
      if (operation && !operation.mutationAttemptedAt) {
        operation.mutationAttemptedAt = this.now().toISOString();
        operation.updatedAt = operation.mutationAttemptedAt;
      }
    });
  }

  async stop(input: RunpodStopInput): Promise<RunpodControlState> {
    this.assertWriteConfiguration();
    if (!validOperationId(input.operationId))
      throw new ApiError(422, "The RunPod idempotency key is invalid.");
    const kind = input.kind ?? "stop";
    const hash = requestHash({ action: "stop", kind });
    return this.withLease(async () => {
      const initial = await this.store.read();
      const existing = this.matchingOperation(
        initial,
        input.operationId,
        kind,
        hash,
      );
      if (existing?.status === "succeeded") return initial;
      const timestamp = this.now().toISOString();
      await this.store.mutate((state) => {
        upsertOperation(state, {
          id: input.operationId,
          kind,
          requestHash: hash,
          status: "pending",
          createdAt: existing?.createdAt ?? timestamp,
          updatedAt: timestamp,
          mutationAttemptedAt: existing?.mutationAttemptedAt ?? null,
          error: null,
        });
      });
      try {
        const state = await this.store.read();
        const pod = await this.findSessionPod(state);
        if (!pod || isStopped(pod)) {
          await this.store.mutate((current) => {
            const operation = current.operations.find(
              (item) => item.id === input.operationId,
            );
            if (operation) {
              operation.status = "succeeded";
              operation.updatedAt = this.now().toISOString();
            }
            current.session.phase = pod ? "stopped" : "off";
            current.session.stopConfirmedAt = this.now().toISOString();
            current.session.lastVerifiedAt = this.now().toISOString();
            current.session.nextRetryAt = null;
            current.session.message = pod
              ? `RunPod stop was verified as ${pod.status}.`
              : "No managed RunPod Pod exists.";
          });
          return await this.store.read();
        }
        if (pod.locked)
          throw new ApiError(409, "The managed RunPod Pod is locked.");
        if (
          pod.actions.length &&
          !pod.actions.some((action) => action.toLowerCase() === "stop")
        )
          throw new ApiError(
            409,
            "RunPod does not currently allow the Pod to be stopped.",
          );
        await this.store.mutate((current) => {
          current.session.phase = "stopping";
          current.session.stopRequestedAt = this.now().toISOString();
          current.session.message = "RunPod stop was requested.";
        });
        await this.markMutationAttempted(input.operationId);
        const stoppedPod = await this.gateway.stopPod(pod.id);
        await this.store.mutate((current) => {
          const confirmed = isStopped(stoppedPod);
          const operation = current.operations.find(
            (item) => item.id === input.operationId,
          );
          if (operation) {
            operation.status = confirmed ? "succeeded" : "pending";
            operation.updatedAt = this.now().toISOString();
          }
          current.session.phase = confirmed ? "stopped" : "stopping";
          current.session.lastVerifiedAt = this.now().toISOString();
          current.session.stopConfirmedAt = confirmed
            ? this.now().toISOString()
            : null;
          if (confirmed) {
            current.session.retryCount = 0;
            current.session.nextRetryAt = null;
          } else if (kind === "watchdog-stop") {
            current.session.retryCount += 1;
            const retry = current.session.retryCount;
            current.session.nextRetryAt =
              retry >= MAX_STOP_FAILURES
                ? null
                : new Date(
                    this.now().getTime() + 30_000 * 2 ** (retry - 1),
                  ).toISOString();
          }
          current.session.message = confirmed
            ? `RunPod stop was verified as ${stoppedPod.status}.`
            : "Waiting for RunPod to confirm the stop.";
        });
        return await this.store.read();
      } catch (error) {
        await this.recordFailure(
          input.operationId,
          error,
          kind === "watchdog-stop",
        );
        throw error;
      }
    });
  }

  async runWatchdog(): Promise<RunpodControlState> {
    const state = await this.store.read();
    if (!this.config.writeEnabled) return state;
    if (
      !state.session.podId ||
      !state.session.hardDeadline ||
      ["off", "stopped"].includes(state.session.phase) ||
      state.session.retryCount >= MAX_STOP_FAILURES
    )
      return state;
    const now = this.now().getTime();
    const deadlineReached = Date.parse(state.session.hardDeadline) <= now;
    const retryDue =
      state.session.nextRetryAt !== null &&
      Date.parse(state.session.nextRetryAt) <= now;
    const shouldStop =
      state.session.retryCount > 0 ? retryDue : deadlineReached;
    if (!shouldStop) return state;
    const identity = requestHash({
      deadline: state.session.hardDeadline,
      retry: state.session.retryCount,
    }).slice(0, 24);
    return this.stop({
      operationId: `watchdog_${identity}`,
      kind: "watchdog-stop",
    });
  }
}

export const runpodController = new RunpodController();
