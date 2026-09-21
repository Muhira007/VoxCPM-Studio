export type RunpodCloud = "community" | "secure";
export type RunpodProfileId = "a5000" | "3090" | "4090";
export type RunpodAvailability = "HIGH" | "MEDIUM" | "LOW" | "NONE" | "UNKNOWN";

export interface RunpodOffer {
  hourlyRate: number | null;
  availability: RunpodAvailability;
  dataCenters: string[];
}

export interface RunpodGpuProfile {
  profileId: RunpodProfileId;
  runpodId: string;
  name: string;
  memoryGb: number | null;
  cudaVersions: string[];
  offers: Record<RunpodCloud, RunpodOffer>;
}

export interface RunpodPodSummary {
  id: string;
  name: string;
  status: string;
  gpuTypeId: string | null;
  image: string | null;
  hourlyRate: number | null;
}

export interface RunpodDataCenterSummary {
  id: string;
  name: string;
  region: string;
  networkVolumeTypes: string[];
}

export interface RunpodOverview {
  mode: "read-only";
  observedAt: string;
  source: "RunPod REST API v2";
  minimumCudaVersion: "12.8";
  writesEnabled: false;
  mutationAttempted: false;
  inventory: {
    podCount: number;
    pods: RunpodPodSummary[];
  };
  catalog: {
    gpuTypeCount: number;
    dataCenterCount: number;
    profiles: RunpodGpuProfile[];
    dataCenters: RunpodDataCenterSummary[];
  };
}

export interface RunpodPlanInput {
  profileId: RunpodProfileId;
  cloud: RunpodCloud;
  durationMinutes: 30 | 60 | 120 | 240;
  maximumHourlyRate: number;
}

export interface RunpodDryRunPlan {
  dryRun: true;
  resourceCreated: false;
  mutationAttempted: false;
  readyForPaidCreate: false;
  profileId: RunpodProfileId;
  runpodGpuId: string;
  cloud: RunpodCloud;
  durationMinutes: number;
  maximumHourlyRate: number;
  hourlyRate: number | null;
  estimatedComputeCost: number | null;
  availability: RunpodAvailability;
  dataCenters: string[];
  image: string;
  containerDiskGb: 20;
  persistentVolumeGb: 30;
  checks: {
    writeOperationsDisabled: true;
    immutableImage: boolean;
    noExistingPods: boolean;
    rateWithinLimit: boolean;
    gpuAvailable: boolean;
    storageSelected: boolean;
  };
  blockers: string[];
  notes: string[];
}
