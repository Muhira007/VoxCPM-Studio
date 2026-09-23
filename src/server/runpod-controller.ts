import { createHash, randomUUID } from "node:crypto";
import type {
  RunpodControlSession,
  RunpodControlOperation,
  RunpodControlPhase,
  RunpodControlState,
  RunpodControlStatus,
  RunpodCostEstimate,
  RunpodOperationKind,
  RunpodStopReason,
} from "../lib/runpod-control-types.ts";
import { RUNPOD_ADMISSION_CUTOFF_SECONDS } from "../lib/runpod-control-types.ts";
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
  emptyRunpodCostLedger,
  emptyRunpodControlSession,
  runpodControlStore,
} from "./runpod-control-store.ts";
import { appStore } from "./store.ts";
import { cancelWorkerJob } from "./worker-client.ts";

const MANAGED_POD_PREFIX = "voxcpm-studio-";
const MAX_STOP_FAILURES = 3;
const LEASE_MILLISECONDS = 120_000;
const STORAGE_MONTHLY_COST_USD = 2.1;

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
  writeScopeConfirmed: boolean;
  balanceConfirmed: boolean;
  singleReplicaConfirmed: boolean;
  persistentStateConfirmed: boolean;
  watchdogDeployed: boolean;
  stopAlertConfigured: boolean;
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
  reason?: RunpodStopReason;
}

export interface RunpodExtendInput {
  operationId: string;
  additionalMinutes: number;
}

export interface RunpodWorkloadSnapshot {
  runningJobCount: number;
  queuedJobCount: number;
  lastActivityAt: string | null;
  idleMinutes: number;
}

export interface RunpodCancellationSummary {
  requestedJobCount: number;
  failedJobCount: number;
}

export interface RunpodWorkloadManager {
  snapshot(): Promise<RunpodWorkloadSnapshot>;
  cancelActive(reason: string): Promise<RunpodCancellationSummary>;
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
  workload?: RunpodWorkloadManager;
}

const appStoreWorkloadManager: RunpodWorkloadManager = {
  async snapshot() {
    const state = await appStore.read();
    const timestamps = state.jobs
      .map((job) => Date.parse(job.updatedAt))
      .filter(Number.isFinite);
    return {
      runningJobCount: state.jobs.filter((job) => job.status === "running")
        .length,
      queuedJobCount: state.jobs.filter((job) => job.status === "queued")
        .length,
      lastActivityAt: timestamps.length
        ? new Date(Math.max(...timestamps)).toISOString()
        : null,
      idleMinutes: state.settings.idleMinutes,
    };
  },
  async cancelActive(reason) {
    const state = await appStore.read();
    const active = state.jobs.filter(
      (job) => job.status === "running" || job.status === "queued",
    );
    const results = await Promise.allSettled(
      active.map((job) => cancelWorkerJob(job.id)),
    );
    const timestamp = new Date().toISOString();
    const activeIds = new Set(active.map((job) => job.id));
    await appStore.mutate((current) => {
      current.jobs = current.jobs.map((job) =>
        activeIds.has(job.id) &&
        (job.status === "running" || job.status === "queued")
          ? {
              ...job,
              status: "cancelled",
              updatedAt: timestamp,
              message: reason,
            }
          : job,
      );
    });
    return {
      requestedJobCount: active.length,
      failedJobCount: results.filter((result) => result.status === "rejected")
        .length,
    };
  },
};

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
    writeScopeConfirmed: serverConfig.runpodWriteScopeConfirmed,
    balanceConfirmed: serverConfig.runpodBalanceConfirmed,
    singleReplicaConfirmed: serverConfig.runpodSingleReplicaConfirmed,
    persistentStateConfirmed: serverConfig.runpodPersistentStateConfirmed,
    watchdogDeployed: serverConfig.runpodWatchdogDeployed,
    stopAlertConfigured: serverConfig.runpodStopAlertConfigured,
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

function admissionCutoff(deadline: number): string {
  return new Date(
    deadline - RUNPOD_ADMISSION_CUTOFF_SECONDS * 1_000,
  ).toISOString();
}

type CostLedgerBucket =
  "startupSeconds" | "activeSeconds" | "idleSeconds" | "shutdownSeconds";

function costLedgerBucket(
  session: RunpodControlSession,
): CostLedgerBucket | null {
  if (!session.podId || ["off", "stopped"].includes(session.phase)) return null;
  if (
    ["planned", "provisioning", "starting", "loading_model"].includes(
      session.phase,
    )
  )
    return "startupSeconds";
  if (session.phase === "ready")
    return session.runningJobCount + session.queuedJobCount > 0
      ? "activeSeconds"
      : "idleSeconds";
  return "shutdownSeconds";
}

function accrueCostLedger(session: RunpodControlSession, observedAt: Date) {
  if (!session.startedAt) return;
  const from = Date.parse(session.costLedger.accruedAt ?? session.startedAt);
  const until = observedAt.getTime();
  if (!Number.isFinite(from) || until <= from) return;
  const bucket = costLedgerBucket(session);
  if (bucket) session.costLedger[bucket] += (until - from) / 1_000;
  session.costLedger.accruedAt = observedAt.toISOString();
}

function roundUsd(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function costEstimate(
  session: RunpodControlSession,
  observedAt: Date,
): RunpodCostEstimate {
  const projectedSession: RunpodControlSession = {
    ...session,
    costLedger: { ...session.costLedger },
  };
  accrueCostLedger(projectedSession, observedAt);
  const rate = projectedSession.hourlyRate;
  const bucket = (seconds: number) => ({
    seconds,
    estimatedCostUsd: rate === null ? 0 : roundUsd((rate * seconds) / 3_600),
  });
  const startup = bucket(projectedSession.costLedger.startupSeconds);
  const active = bucket(projectedSession.costLedger.activeSeconds);
  const idle = bucket(projectedSession.costLedger.idleSeconds);
  const shutdown = bucket(projectedSession.costLedger.shutdownSeconds);
  const totalSeconds =
    startup.seconds + active.seconds + idle.seconds + shutdown.seconds;
  const accruedComputeCostUsd =
    rate === null ? 0 : roundUsd((rate * totalSeconds) / 3_600);
  const deadline = projectedSession.hardDeadline
    ? Date.parse(projectedSession.hardDeadline)
    : Number.NaN;
  const terminal = ["off", "stopped"].includes(projectedSession.phase);
  const remainingSeconds =
    !terminal && Number.isFinite(deadline)
      ? Math.max(0, (deadline - observedAt.getTime()) / 1_000)
      : 0;
  const remainingComputeExposureUsd =
    rate === null ? 0 : roundUsd((rate * remainingSeconds) / 3_600);
  return {
    observedAt: observedAt.toISOString(),
    estimated: true,
    hourlyRate: rate,
    startup,
    active,
    idle,
    shutdown,
    totalSeconds,
    accruedComputeCostUsd,
    remainingComputeExposureUsd,
    projectedComputeCostUsd: roundUsd(
      accruedComputeCostUsd + remainingComputeExposureUsd,
    ),
    storageMonthlyCostUsd: STORAGE_MONTHLY_COST_USD,
  };
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
  private readonly workload: RunpodWorkloadManager;

  constructor(dependencies: RunpodControllerDependencies = {}) {
    this.store = dependencies.store ?? runpodControlStore;
    this.gateway = dependencies.gateway ?? runpodControlGateway;
    this.catalog = dependencies.catalog ?? runpodClient;
    this.config = dependencies.config ?? defaultConfig();
    this.now = dependencies.now ?? (() => new Date());
    this.workerProbe = dependencies.workerProbe ?? defaultWorkerProbe;
    this.workload = dependencies.workload ?? appStoreWorkloadManager;
  }

  private writeConfigurationErrors(): string[] {
    const errors = this.stopConfigurationErrors();
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
    if (!this.config.writeScopeConfirmed)
      errors.push("RUNPOD_WRITE_SCOPE_CONFIRMED is false.");
    if (!this.config.balanceConfirmed)
      errors.push("RUNPOD_BALANCE_CONFIRMED is false.");
    if (!this.config.singleReplicaConfirmed)
      errors.push("RUNPOD_SINGLE_REPLICA_CONFIRMED is false.");
    if (!this.config.persistentStateConfirmed)
      errors.push("RUNPOD_PERSISTENT_STATE_CONFIRMED is false.");
    if (!this.config.watchdogDeployed)
      errors.push("RUNPOD_WATCHDOG_DEPLOYED is false.");
    if (!this.config.stopAlertConfigured)
      errors.push("RUNPOD_STOP_ALERT_CONFIGURED is false.");
    return errors;
  }

  private stopConfigurationErrors(): string[] {
    const errors: string[] = [];
    if (!this.config.writeEnabled)
      errors.push("RUNPOD_WRITE_ENABLED is false.");
    if (this.config.apiKey.length < 32)
      errors.push("RUNPOD_API_KEY is not configured for the control plane.");
    return errors;
  }

  private assertWriteConfiguration() {
    const errors = this.writeConfigurationErrors();
    if (errors.length) throw new ApiError(423, errors[0]);
  }

  private assertStopConfiguration() {
    const errors = this.stopConfigurationErrors();
    if (errors.length) throw new ApiError(423, errors[0]);
  }

  async status(): Promise<RunpodControlStatus> {
    const state = await this.store.read();
    const observedAt = this.now();
    const blockers = this.writeConfigurationErrors();
    return {
      writeEnabled: this.config.writeEnabled,
      liveMutationAttempted: state.operations.some((operation) =>
        Boolean(operation.mutationAttemptedAt),
      ),
      phase: state.session.phase,
      session: state.session,
      costEstimate: costEstimate(state.session, observedAt),
      storage: {
        strategy: "network-volume",
        tier: "standard",
        sizeGb: 30,
        mountPath: "/workspace",
        estimatedMonthlyUsd: STORAGE_MONTHLY_COST_USD,
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
        admissionCutoffSeconds: RUNPOD_ADMISSION_CUTOFF_SECONDS,
      },
      safeguards: {
        immutableImage: /@sha256:[a-f0-9]{64}$/.test(this.config.workerImage),
        idempotency: true,
        persistedLease: true,
        crossProcessFileLock: true,
        schedulerCommandReady: true,
        singleReplicaRequired: true,
        singleReplicaConfirmed: this.config.singleReplicaConfirmed,
        persistentStateConfirmed: this.config.persistentStateConfirmed,
        writeScopeConfirmed: this.config.writeScopeConfirmed,
        balanceConfirmed: this.config.balanceConfirmed,
        reconcileBeforeCreate: true,
        hardDeadline: true,
        workloadAwareIdleDeadline: true,
        hardDeadlineDrain: true,
        atomicDeadlineExtension: true,
        persistedCostLedger: true,
        verifiedStopRequired: true,
        terminateImplemented: false,
        cloudWatchdogDeployed: this.config.watchdogDeployed,
        stopAlertConfigured: this.config.stopAlertConfigured,
      },
      blockers,
    };
  }

  async assertJobAdmission(): Promise<void> {
    if (!this.config.writeEnabled) return;
    this.assertWriteConfiguration();
    const state = await this.store.read();
    if (state.session.phase !== "ready")
      throw new ApiError(409, "The RunPod worker is not ready for a new job.");
    const cutoff = state.session.admissionCutoffAt
      ? Date.parse(state.session.admissionCutoffAt)
      : Number.NaN;
    if (
      state.session.drainStartedAt ||
      !Number.isFinite(cutoff) ||
      cutoff <= this.now().getTime()
    )
      throw new ApiError(
        409,
        "The RunPod session is draining before its hard deadline and cannot accept a new job.",
      );
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

  async syncWorkload(): Promise<RunpodControlState> {
    const workload = await this.workload.snapshot();
    if (
      !Number.isInteger(workload.runningJobCount) ||
      workload.runningJobCount < 0 ||
      !Number.isInteger(workload.queuedJobCount) ||
      workload.queuedJobCount < 0 ||
      ![5, 10, 15, 30].includes(workload.idleMinutes)
    )
      throw new ApiError(502, "The workload snapshot is invalid.");
    const parsedActivity = workload.lastActivityAt
      ? Date.parse(workload.lastActivityAt)
      : Number.NaN;
    if (workload.lastActivityAt && !Number.isFinite(parsedActivity))
      throw new ApiError(502, "The workload activity timestamp is invalid.");
    const now = this.now();
    await this.store.mutate((state) => {
      accrueCostLedger(state.session, now);
      state.session.runningJobCount = workload.runningJobCount;
      state.session.queuedJobCount = workload.queuedJobCount;
      state.session.lastActivityAt = workload.lastActivityAt;
      state.session.workloadSyncedAt = now.toISOString();
      state.session.idleMinutes = workload.idleMinutes;
      const busy = workload.runningJobCount + workload.queuedJobCount > 0;
      if (state.session.phase !== "ready" || busy) {
        state.session.idleDeadline = null;
        return;
      }
      const candidates = [
        state.session.startedAt,
        state.session.readyAt,
        workload.lastActivityAt,
      ]
        .map((value) => (value ? Date.parse(value) : Number.NaN))
        .filter(Number.isFinite)
        .map((value) => Math.min(value, now.getTime()));
      const baseline = candidates.length
        ? Math.max(...candidates)
        : now.getTime();
      state.session.idleDeadline = new Date(
        baseline + workload.idleMinutes * 60_000,
      ).toISOString();
    });
    return await this.store.read();
  }

  async observeWorkloadBestEffort(): Promise<boolean> {
    if (!this.config.writeEnabled) return false;
    const state = await this.store.read();
    if (
      !state.session.podId ||
      ["off", "stopped"].includes(state.session.phase)
    )
      return false;
    try {
      await this.syncWorkload();
      return true;
    } catch {
      return false;
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

  async extend(input: RunpodExtendInput): Promise<RunpodControlState> {
    this.assertWriteConfiguration();
    if (!validOperationId(input.operationId))
      throw new ApiError(422, "The RunPod idempotency key is invalid.");
    if (input.additionalMinutes !== 30)
      throw new ApiError(
        422,
        "A RunPod session can only be extended by 30 minutes at a time.",
      );
    const hash = requestHash({
      action: "extend",
      additionalMinutes: input.additionalMinutes,
    });
    return this.withLease(async () => {
      const initial = await this.store.read();
      const existing = this.matchingOperation(
        initial,
        input.operationId,
        "extend",
        hash,
      );
      if (existing?.status === "succeeded") return initial;
      if (
        initial.session.phase !== "ready" ||
        !initial.session.startedAt ||
        !initial.session.hardDeadline ||
        initial.session.drainStartedAt ||
        initial.session.hourlyRate === null
      )
        throw new ApiError(409, "No ready RunPod session can be extended.");
      const startedAt = Date.parse(initial.session.startedAt);
      const currentDeadline = Date.parse(initial.session.hardDeadline);
      if (
        !Number.isFinite(startedAt) ||
        !Number.isFinite(currentDeadline) ||
        currentDeadline <= this.now().getTime()
      )
        throw new ApiError(409, "The RunPod session deadline already passed.");
      const nextDeadline = currentDeadline + input.additionalMinutes * 60_000;
      const maximumDeadline =
        startedAt + this.config.maximumSessionMinutes * 60_000;
      if (nextDeadline > maximumDeadline)
        throw new ApiError(
          409,
          "The RunPod session already reached its maximum duration.",
        );
      const estimatedComputeCost =
        (initial.session.hourlyRate * (nextDeadline - startedAt)) / 3_600_000;
      if (estimatedComputeCost > this.config.hardCostLimitUsd)
        throw new ApiError(
          409,
          "The extended session would exceed the hard cost limit.",
        );
      const timestamp = this.now().toISOString();
      await this.store.mutate((state) => {
        accrueCostLedger(state.session, new Date(timestamp));
        state.session.hardDeadline = new Date(nextDeadline).toISOString();
        state.session.admissionCutoffAt = admissionCutoff(nextDeadline);
        upsertOperation(state, {
          id: input.operationId,
          kind: "extend",
          requestHash: hash,
          status: "succeeded",
          createdAt: existing?.createdAt ?? timestamp,
          updatedAt: timestamp,
          mutationAttemptedAt: null,
          error: null,
        });
      });
      return await this.store.read();
    });
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
      const hardDeadline = now.getTime() + input.durationMinutes * 60_000;
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
          hardDeadline: new Date(hardDeadline).toISOString(),
          admissionCutoffAt: admissionCutoff(hardDeadline),
          costLedger: {
            ...emptyRunpodCostLedger(),
            accruedAt: now.toISOString(),
          },
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
        const verifiedAt = this.now();
        await this.store.mutate((state) => {
          accrueCostLedger(state.session, verifiedAt);
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
          state.session.lastVerifiedAt = verifiedAt.toISOString();
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
      const verifiedAt = this.now();
      await this.store.mutate((state) => {
        accrueCostLedger(state.session, verifiedAt);
        state.session.phase = "off";
        state.session.podId = null;
        state.session.workerReady = false;
        state.session.lastVerifiedAt = verifiedAt.toISOString();
        state.session.message =
          "No managed RunPod Pod exists; the last cost estimate was preserved.";
      });
      return await this.store.read();
    }
    let workerReady = false;
    if (pod.status === "RUNNING" && initial.session.phase !== "stopping")
      workerReady = await this.workerProbe(pod.id);
    const verifiedAt = this.now();
    await this.store.mutate((state) => {
      accrueCostLedger(state.session, verifiedAt);
      state.session.podId = pod.id;
      state.session.podName = pod.name;
      state.session.lastVerifiedAt = verifiedAt.toISOString();
      state.session.workerReady = workerReady;
      if (isStopped(pod)) {
        state.session.phase = "stopped";
        state.session.stopConfirmedAt = verifiedAt.toISOString();
        state.session.nextRetryAt = null;
        state.session.message = `RunPod stop was verified as ${pod.status}.`;
        for (const operation of state.operations) {
          if (
            operation.status === "pending" &&
            ["stop", "watchdog-stop"].includes(operation.kind)
          ) {
            operation.status = "succeeded";
            operation.updatedAt = verifiedAt.toISOString();
            operation.error = null;
          }
        }
      } else if (pod.status === "RUNNING") {
        if (workerReady && !state.session.readyAt)
          state.session.readyAt = verifiedAt.toISOString();
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
    const failedAt = this.now();
    await this.store.mutate((state) => {
      accrueCostLedger(state.session, failedAt);
      const operation = state.operations.find(
        (item) => item.id === operationId,
      );
      if (operation) {
        operation.status = "failed";
        operation.updatedAt = failedAt.toISOString();
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
                failedAt.getTime() + 30_000 * 2 ** (retry - 1),
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
    this.assertStopConfiguration();
    if (!validOperationId(input.operationId))
      throw new ApiError(422, "The RunPod idempotency key is invalid.");
    const kind = input.kind ?? "stop";
    const reason = input.reason ?? "manual";
    const hash = requestHash({ action: "stop", kind, reason });
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
          const confirmedAt = this.now();
          await this.store.mutate((current) => {
            accrueCostLedger(current.session, confirmedAt);
            const operation = current.operations.find(
              (item) => item.id === input.operationId,
            );
            if (operation) {
              operation.status = "succeeded";
              operation.updatedAt = this.now().toISOString();
            }
            current.session.phase = pod ? "stopped" : "off";
            current.session.stopConfirmedAt = confirmedAt.toISOString();
            current.session.stopReason = reason;
            current.session.lastVerifiedAt = confirmedAt.toISOString();
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
        const requestedAt = this.now();
        await this.store.mutate((current) => {
          accrueCostLedger(current.session, requestedAt);
          current.session.phase = "stopping";
          current.session.stopRequestedAt = requestedAt.toISOString();
          current.session.stopReason = reason;
          current.session.message = "RunPod stop was requested.";
        });
        await this.markMutationAttempted(input.operationId);
        const stoppedPod = await this.gateway.stopPod(pod.id);
        const verifiedAt = this.now();
        await this.store.mutate((current) => {
          accrueCostLedger(current.session, verifiedAt);
          const confirmed = isStopped(stoppedPod);
          const operation = current.operations.find(
            (item) => item.id === input.operationId,
          );
          if (operation) {
            operation.status = confirmed ? "succeeded" : "pending";
            operation.updatedAt = this.now().toISOString();
          }
          current.session.phase = confirmed ? "stopped" : "stopping";
          current.session.lastVerifiedAt = verifiedAt.toISOString();
          current.session.stopConfirmedAt = confirmed
            ? verifiedAt.toISOString()
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
                    verifiedAt.getTime() + 30_000 * 2 ** (retry - 1),
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

  private async beginHardDeadlineDrain(): Promise<RunpodControlState> {
    const attemptTime = this.now();
    const timestamp = attemptTime.toISOString();
    const claimed = await this.store.mutate((state) => {
      if (state.session.drainCompletedAt) return false;
      const previousAttempt = state.session.cancellationRequestedAt
        ? Date.parse(state.session.cancellationRequestedAt)
        : Number.NaN;
      if (
        Number.isFinite(previousAttempt) &&
        attemptTime.getTime() - previousAttempt < LEASE_MILLISECONDS
      )
        return false;
      state.session.drainStartedAt ??= timestamp;
      state.session.cancellationRequestedAt = timestamp;
      state.session.idleDeadline = null;
      state.session.message =
        "RunPod hard deadline is approaching; new jobs are blocked and active jobs are being cancelled.";
      return true;
    });
    if (!claimed) return await this.store.read();
    let summary: RunpodCancellationSummary;
    try {
      summary = await this.workload.cancelActive(
        "Cancelled because the RunPod hard deadline is approaching.",
      );
    } catch {
      const state = await this.store.read();
      const active =
        state.session.runningJobCount + state.session.queuedJobCount;
      summary = { requestedJobCount: active, failedJobCount: active };
    }
    const completedAt = this.now().toISOString();
    await this.store.mutate((state) => {
      accrueCostLedger(state.session, new Date(completedAt));
      state.session.drainCompletedAt = completedAt;
      state.session.cancelledJobCount = summary.requestedJobCount;
      state.session.cancellationFailureCount = summary.failedJobCount;
      state.session.runningJobCount = 0;
      state.session.queuedJobCount = 0;
      if (!["stopping", "stopped"].includes(state.session.phase))
        state.session.message = summary.failedJobCount
          ? `RunPod drain requested cancellation for ${summary.requestedJobCount} job(s); ${summary.failedJobCount} worker cancellation request(s) failed and hard stop remains scheduled.`
          : `RunPod drain completed; ${summary.requestedJobCount} active job(s) were cancelled before the hard deadline.`;
    });
    return await this.store.read();
  }

  async runWatchdog(): Promise<RunpodControlState> {
    let state = await this.store.read();
    if (!this.config.writeEnabled) return state;
    if (
      !state.session.podId ||
      ["off", "stopped"].includes(state.session.phase) ||
      state.session.retryCount >= MAX_STOP_FAILURES
    )
      return state;
    const now = this.now().getTime();
    const hardDeadlineReached =
      state.session.hardDeadline !== null &&
      Date.parse(state.session.hardDeadline) <= now;
    const admissionCutoffReached =
      state.session.admissionCutoffAt !== null &&
      Date.parse(state.session.admissionCutoffAt) <= now;
    const retryDue =
      state.session.nextRetryAt !== null &&
      Date.parse(state.session.nextRetryAt) <= now;
    if (state.session.retryCount > 0 && !retryDue) return state;
    let reason: RunpodStopReason;
    if (state.session.retryCount > 0)
      reason = state.session.stopReason ?? "hard_deadline";
    else if (hardDeadlineReached) {
      state = await this.beginHardDeadlineDrain();
      reason = "hard_deadline";
    } else if (admissionCutoffReached || state.session.drainStartedAt) {
      return await this.beginHardDeadlineDrain();
    } else {
      state = await this.syncWorkload();
      const idleDeadlineReached =
        state.session.idleDeadline !== null &&
        state.session.runningJobCount === 0 &&
        state.session.queuedJobCount === 0 &&
        Date.parse(state.session.idleDeadline) <= now;
      if (!idleDeadlineReached) return state;
      reason = "idle_deadline";
    }
    const identity = requestHash({
      deadline:
        reason === "hard_deadline"
          ? state.session.hardDeadline
          : state.session.idleDeadline,
      reason,
      retry: state.session.retryCount,
    }).slice(0, 24);
    return this.stop({
      operationId: `watchdog_${identity}`,
      kind: "watchdog-stop",
      reason,
    });
  }
}

export const runpodController = new RunpodController();
