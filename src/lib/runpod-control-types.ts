import type { RunpodCloud, RunpodProfileId } from "./runpod-types";

export const RUNPOD_ADMISSION_CUTOFF_SECONDS = 5 * 60;

export type RunpodControlPhase =
  | "off"
  | "planned"
  | "provisioning"
  | "starting"
  | "loading_model"
  | "ready"
  | "stopping"
  | "stopped"
  | "error";

export type RunpodOperationKind = "start" | "extend" | "stop" | "watchdog-stop";
export type RunpodOperationStatus = "pending" | "succeeded" | "failed";
export type RunpodStopReason = "manual" | "hard_deadline" | "idle_deadline";

export interface RunpodCostLedger {
  accruedAt: string | null;
  startupSeconds: number;
  activeSeconds: number;
  idleSeconds: number;
  shutdownSeconds: number;
}

export interface RunpodCostBucket {
  seconds: number;
  estimatedCostUsd: number;
}

export interface RunpodCostEstimate {
  observedAt: string;
  estimated: true;
  hourlyRate: number | null;
  startup: RunpodCostBucket;
  active: RunpodCostBucket;
  idle: RunpodCostBucket;
  shutdown: RunpodCostBucket;
  totalSeconds: number;
  accruedComputeCostUsd: number;
  remainingComputeExposureUsd: number;
  projectedComputeCostUsd: number;
  storageMonthlyCostUsd: number;
}

export interface RunpodControlSession {
  phase: RunpodControlPhase;
  podId: string | null;
  podName: string | null;
  operationId: string | null;
  profileId: RunpodProfileId | null;
  cloud: RunpodCloud | null;
  dataCenterId: string | null;
  networkVolumeId: string | null;
  hourlyRate: number | null;
  startedAt: string | null;
  readyAt: string | null;
  hardDeadline: string | null;
  admissionCutoffAt: string | null;
  idleDeadline: string | null;
  idleMinutes: number;
  runningJobCount: number;
  queuedJobCount: number;
  lastActivityAt: string | null;
  workloadSyncedAt: string | null;
  drainStartedAt: string | null;
  drainCompletedAt: string | null;
  cancellationRequestedAt: string | null;
  cancelledJobCount: number;
  cancellationFailureCount: number;
  costLedger: RunpodCostLedger;
  stopRequestedAt: string | null;
  stopConfirmedAt: string | null;
  stopReason: RunpodStopReason | null;
  lastVerifiedAt: string | null;
  workerReady: boolean;
  retryCount: number;
  nextRetryAt: string | null;
  message: string;
}

export interface RunpodControlOperation {
  id: string;
  kind: RunpodOperationKind;
  requestHash: string;
  status: RunpodOperationStatus;
  createdAt: string;
  updatedAt: string;
  mutationAttemptedAt: string | null;
  error: string | null;
}

export interface RunpodControlState {
  version: 1;
  revision: number;
  session: RunpodControlSession;
  lease: { owner: string; expiresAt: string } | null;
  operations: RunpodControlOperation[];
}

export interface RunpodControlStatus {
  writeEnabled: boolean;
  liveMutationAttempted: boolean;
  phase: RunpodControlPhase;
  session: RunpodControlSession;
  costEstimate: RunpodCostEstimate;
  storage: {
    strategy: "network-volume";
    tier: "standard";
    sizeGb: 30;
    mountPath: "/workspace";
    estimatedMonthlyUsd: 2.1;
    volumeConfigured: boolean;
    dataCenterConfigured: boolean;
  };
  limits: {
    maximumSessionMinutes: number;
    hardCostLimitUsd: number;
    admissionCutoffSeconds: number;
  };
  safeguards: {
    immutableImage: boolean;
    idempotency: true;
    persistedLease: true;
    crossProcessFileLock: true;
    schedulerCommandReady: true;
    singleReplicaRequired: true;
    reconcileBeforeCreate: true;
    hardDeadline: true;
    workloadAwareIdleDeadline: true;
    hardDeadlineDrain: true;
    atomicDeadlineExtension: true;
    persistedCostLedger: true;
    verifiedStopRequired: true;
    terminateImplemented: false;
    cloudWatchdogDeployed: false;
  };
  blockers: string[];
}
