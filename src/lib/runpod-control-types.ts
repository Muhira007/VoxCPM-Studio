import type { RunpodCloud, RunpodProfileId } from "./runpod-types";

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

export type RunpodOperationKind = "start" | "stop" | "watchdog-stop";
export type RunpodOperationStatus = "pending" | "succeeded" | "failed";

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
  hardDeadline: string | null;
  idleDeadline: string | null;
  stopRequestedAt: string | null;
  stopConfirmedAt: string | null;
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
    verifiedStopRequired: true;
    terminateImplemented: false;
    cloudWatchdogDeployed: false;
  };
  blockers: string[];
}
