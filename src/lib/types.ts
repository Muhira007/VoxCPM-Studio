export type SynthesisMode = "tts" | "design" | "clone" | "hifi";
export type StylePreset = "natural" | "calm" | "cheerful" | "dramatic";
export type GpuStatus =
  "off" | "provisioning" | "loading" | "ready" | "stopping" | "error";
export type JobStatus =
  "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type DemoScenario =
  "normal" | "unavailable" | "slow" | "failure" | "disconnected";

export interface Voice {
  id: string;
  name: string;
  description: string;
  source: "example" | "upload" | "designed";
  color: "orange" | "purple" | "blue" | "green";
  duration?: number;
  fileName?: string;
  audioUrl?: string;
  createdAt: number;
}

export interface SynthesisRequest {
  text: string;
  mode: SynthesisMode;
  voiceId: string;
  description: string;
  transcript: string;
  style: StylePreset;
}

export interface SynthesisSegment {
  index: number;
  tags: string[];
  text: string;
  controlInstruction: string | null;
  targetText: string;
  pauseAfterMs: number;
  status: JobStatus;
  progress: number;
  message: string;
  audioDuration: number | null;
}

export interface SynthesisJob {
  id: string;
  request: SynthesisRequest;
  voiceName: string;
  createdAt: number;
  status: JobStatus;
  progress: number;
  message?: string;
  // Demo jobs never receive a fabricated output URL or audio duration.
  audioUrl: string | null;
  audioDuration: number | null;
  segments: SynthesisSegment[];
}

export interface GpuSession {
  status: GpuStatus;
  startedAt: number | null;
  expiresAt: number | null;
  lastActivityAt: number | null;
  endedAt: number | null;
  gpuId: string;
  message?: string;
}

export interface AppSettings {
  sessionMinutes: number;
  idleMinutes: number;
  maxHourlyRate: number;
  gpuId: string;
  scenario: DemoScenario;
}

export interface StudioSnapshot {
  hydrated: boolean;
  draft: SynthesisRequest;
  voices: Voice[];
  jobs: SynthesisJob[];
  session: GpuSession;
  settings: AppSettings;
  now: number;
  storageWarning: string | null;
}

export interface StudioService {
  readonly mode: "demo" | "api";
  subscribe(listener: () => void): () => void;
  getSnapshot(): StudioSnapshot;
  updateDraft(patch: Partial<SynthesisRequest>): void;
  updateSettings(patch: Partial<AppSettings>): void;
  startSession(): void | Promise<void>;
  stopSession(): void | Promise<void>;
  extendSession(): void | Promise<void>;
  generate(): void | Promise<void>;
  cancelJob(id: string): void | Promise<void>;
  retrySegment(jobId: string, segmentIndex: number): void | Promise<void>;
  addVoice(voice: Voice, file?: File): string | Promise<string>;
  editVoice(id: string, name: string, description: string): void | Promise<void>;
  removeVoice(id: string): void | Promise<void>;
  resetLocalData(): void | Promise<void>;
  logout(): void | Promise<void>;
}

// Local adapter lifecycle is kept in the provider, away from page components.
export interface LocalStudioAdapter extends StudioService {
  hydrate(serialized: string | null): void;
  serialize(): string;
  reportStorageWarning(message: string): void;
  tick(): void;
  dispose(): void;
}
