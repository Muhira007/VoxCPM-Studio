import type { JobStatus, SynthesisRequest, SynthesisSegment } from "@/lib/types";

export type ApiSessionStatus = "off" | "loading" | "ready" | "stopping" | "error";

export interface ApiSession {
  status: ApiSessionStatus;
  startedAt: string | null;
  expiresAt: string | null;
  endedAt: string | null;
  message: string;
  mode: "worker-simulation";
}

export interface ServerJob {
  id: string;
  idempotencyKey: string;
  requestHash: string;
  request: SynthesisRequest;
  voiceName: string;
  status: JobStatus;
  progress: number;
  createdAt: string;
  updatedAt: string;
  message: string;
  outputFile: string | null;
  audioDuration: number | null;
  segments: SynthesisSegment[];
}

export interface ServerVoice {
  id: string;
  name: string;
  description: string;
  fileName: string;
  storageName: string;
  contentType: string;
  size: number;
  createdAt: string;
}

export interface PersistedAppState {
  version: 1;
  session: ApiSession;
  jobs: ServerJob[];
  voices: ServerVoice[];
  settings: ServerSettings;
}

export interface ServerSettings {
  sessionMinutes: 30 | 60 | 120 | 240;
  idleMinutes: 5 | 10 | 15 | 30;
  maximumHourlyRate: number;
  gpuProfile: "a5000" | "rtx3090" | "rtx4090";
}

export interface WorkerJobResponse {
  id: string;
  status: JobStatus;
  progress: number;
  message: string | null;
  output_path: string | null;
  audio_duration: number | null;
  segments: WorkerSegmentResponse[];
}

export interface WorkerSegmentResponse {
  index: number;
  status: JobStatus;
  progress: number;
  message: string | null;
  audio_duration: number | null;
}
