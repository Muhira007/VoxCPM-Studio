"use client";

import { validateRequest } from "./demo-service.ts";
import {
  DEFAULT_DRAFT,
  DEFAULT_SETTINGS,
  EXAMPLE_VOICES,
} from "./fixtures.ts";
import type {
  AppSettings,
  GpuSession,
  StudioService,
  StudioSnapshot,
  SynthesisJob,
  SynthesisRequest,
  Voice,
} from "./types.ts";
import type { AudioQualityReport } from "./audio-analysis.ts";

export const API_STORAGE_KEY = "voxcpm-studio-api:v1";

interface ApiSession {
  status: "off" | "loading" | "ready" | "stopping" | "error";
  startedAt: string | null;
  expiresAt: string | null;
  endedAt: string | null;
  message: string;
}

interface ApiJob {
  id: string;
  request: SynthesisRequest;
  voiceName: string;
  status: SynthesisJob["status"];
  progress: number;
  createdAt: string;
  message: string;
  outputFile: string | null;
  audioDuration: number | null;
  segments: SynthesisJob["segments"];
}

interface ApiVoice {
  id: string;
  name: string;
  description: string;
  fileName: string;
  analysis?: AudioQualityReport;
  createdAt: string;
}

interface ApiSettings {
  sessionMinutes: number;
  idleMinutes: number;
  maximumHourlyRate: number;
  gpuProfile: "a5000" | "rtx3090" | "rtx4090";
}

function timestamp(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapGpuFromServer(value: ApiSettings["gpuProfile"]): string {
  return value === "rtx3090" ? "3090" : value === "rtx4090" ? "4090" : value;
}

function mapGpuToServer(value: string): ApiSettings["gpuProfile"] {
  return value === "3090" ? "rtx3090" : value === "4090" ? "rtx4090" : "a5000";
}

function mapSession(session: ApiSession, gpuId: string): GpuSession {
  return {
    status: session.status,
    startedAt: timestamp(session.startedAt),
    expiresAt: timestamp(session.expiresAt),
    lastActivityAt: timestamp(session.startedAt),
    endedAt: timestamp(session.endedAt),
    gpuId,
    message: session.message,
  };
}

function mapJob(job: ApiJob): SynthesisJob {
  return {
    id: job.id,
    request: job.request,
    voiceName: job.voiceName,
    createdAt: timestamp(job.createdAt) || Date.now(),
    status: job.status,
    progress: job.progress,
    message: job.message,
    audioUrl: job.outputFile ? `/api/v1/jobs/${encodeURIComponent(job.id)}/audio` : null,
    audioDuration: job.audioDuration,
    segments: Array.isArray(job.segments) ? job.segments : [],
  };
}

function mapVoice(voice: ApiVoice): Voice {
  return {
    id: voice.id,
    name: voice.name,
    description: voice.description,
    source: "upload",
    color: "green",
    fileName: voice.fileName,
    duration: voice.analysis?.durationSeconds,
    analysis: voice.analysis,
    audioUrl: `/api/v1/voices/${encodeURIComponent(voice.id)}/audio`,
    createdAt: timestamp(voice.createdAt) || Date.now(),
  };
}

function restoredDraft(serialized: string | null): SynthesisRequest {
  if (!serialized) return { ...DEFAULT_DRAFT };
  try {
    const parsed = JSON.parse(serialized) as {
      version?: unknown;
      draft?: Partial<SynthesisRequest>;
    };
    if (parsed.version !== 1 || !parsed.draft) return { ...DEFAULT_DRAFT };
    const draft = { ...DEFAULT_DRAFT, ...parsed.draft };
    if (draft.mode === "hifi") draft.style = "natural";
    return draft;
  } catch {
    return { ...DEFAULT_DRAFT };
  }
}

export class ApiStudioService implements StudioService {
  readonly mode = "api" as const;
  private snapshot: StudioSnapshot = {
    hydrated: false,
    draft: { ...DEFAULT_DRAFT },
    voices: [...EXAMPLE_VOICES],
    jobs: [],
    session: {
      status: "off",
      startedAt: null,
      expiresAt: null,
      lastActivityAt: null,
      endedAt: null,
      gpuId: DEFAULT_SETTINGS.gpuId,
    },
    settings: { ...DEFAULT_SETTINGS },
    now: Date.now(),
    storageWarning: null,
  };
  private listeners = new Set<() => void>();
  private lastPoll = 0;
  private pollPromise: Promise<void> | null = null;
  private settingsTimer: ReturnType<typeof setTimeout> | null = null;
  private actionBusy = false;
  private readonly onUnauthorized: () => void;
  private readonly fetcher: typeof fetch;

  constructor(
    onUnauthorized: () => void,
    fetcher: typeof fetch = fetch,
  ) {
    this.onUnauthorized = onUnauthorized;
    this.fetcher = fetcher.bind(globalThis);
  }

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(patch: Partial<StudioSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    const response = await this.fetcher(path, {
      ...init,
      headers,
      credentials: "same-origin",
      cache: "no-store",
    });
    if (response.status === 401) {
      this.onUnauthorized();
      throw new Error("Sesi masuk berakhir. Masuk kembali untuk melanjutkan.");
    }
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;
      throw new Error(payload?.message || `Permintaan API gagal (${response.status}).`);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
  private saveDraft() {
    try {
      localStorage.setItem(
        API_STORAGE_KEY,
        JSON.stringify({ version: 1, draft: this.snapshot.draft }),
      );
    } catch {
      this.publish({
        storageWarning: "Draft tidak dapat disimpan di browser ini.",
      });
    }
  }
  async hydrate(serialized: string | null) {
    const draft = restoredDraft(serialized);
    try {
      const [sessionResponse, jobsResponse, voicesResponse, settingsResponse] =
        await Promise.all([
          this.request<{ session: ApiSession }>("/api/v1/sessions"),
          this.request<{ jobs: ApiJob[] }>("/api/v1/jobs"),
          this.request<{ voices: ApiVoice[] }>("/api/v1/voices"),
          this.request<{ settings: ApiSettings }>("/api/v1/settings"),
        ]);
      const settings: AppSettings = {
        sessionMinutes: settingsResponse.settings.sessionMinutes,
        idleMinutes: settingsResponse.settings.idleMinutes,
        maxHourlyRate: settingsResponse.settings.maximumHourlyRate,
        gpuId: mapGpuFromServer(settingsResponse.settings.gpuProfile),
        scenario: "normal",
      };
      const voices = [
        ...EXAMPLE_VOICES,
        ...voicesResponse.voices.map(mapVoice),
      ];
      if (!voices.some((voice) => voice.id === draft.voiceId))
        draft.voiceId = DEFAULT_DRAFT.voiceId;
      this.publish({
        hydrated: true,
        draft,
        voices,
        jobs: jobsResponse.jobs.map(mapJob),
        settings,
        session: mapSession(sessionResponse.session, settings.gpuId),
        now: Date.now(),
        storageWarning: null,
      });
    } catch (error) {
      this.publish({
        hydrated: true,
        draft,
        storageWarning:
          error instanceof Error ? error.message : "API lokal tidak dapat dimuat.",
      });
      throw error;
    }
  }
  updateDraft(patch: Partial<SynthesisRequest>) {
    const next = { ...this.snapshot.draft, ...patch };
    if (next.mode === "hifi") next.style = "natural";
    this.publish({ draft: next });
    this.saveDraft();
  }
  updateSettings(patch: Partial<AppSettings>) {
    const settings = { ...this.snapshot.settings, ...patch };
    this.publish({ settings });
    if (this.settingsTimer) clearTimeout(this.settingsTimer);
    this.settingsTimer = setTimeout(() => {
      this.settingsTimer = null;
      void this.persistSettings();
    }, 250);
  }
  private async persistSettings() {
    try {
      const response = await this.request<{ settings: ApiSettings }>(
        "/api/v1/settings",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionMinutes: this.snapshot.settings.sessionMinutes,
            idleMinutes: this.snapshot.settings.idleMinutes,
            maximumHourlyRate: this.snapshot.settings.maxHourlyRate,
            gpuProfile: mapGpuToServer(this.snapshot.settings.gpuId),
          }),
        },
      );
      this.publish({
        settings: {
          ...this.snapshot.settings,
          sessionMinutes: response.settings.sessionMinutes,
          idleMinutes: response.settings.idleMinutes,
          maxHourlyRate: response.settings.maximumHourlyRate,
          gpuId: mapGpuFromServer(response.settings.gpuProfile),
        },
        storageWarning: null,
      });
    } catch (error) {
      this.publish({
        storageWarning:
          error instanceof Error
            ? `Pengaturan server belum tersimpan: ${error.message}`
            : "Pengaturan server belum tersimpan.",
      });
    }
  }
  async startSession() {
    if (this.actionBusy || !["off", "error"].includes(this.snapshot.session.status))
      return;
    this.actionBusy = true;
    this.publish({
      session: {
        ...this.snapshot.session,
        status: "provisioning",
        message: "Menghubungi worker simulasi lokal.",
      },
    });
    try {
      const response = await this.request<{ session: ApiSession }>(
        "/api/v1/sessions",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            durationMinutes: this.snapshot.settings.sessionMinutes,
          }),
        },
      );
      this.publish({
        session: mapSession(response.session, this.snapshot.settings.gpuId),
      });
    } catch (error) {
      this.publish({
        session: {
          ...this.snapshot.session,
          status: "error",
          endedAt: Date.now(),
          message: error instanceof Error ? error.message : "Sesi gagal dimulai.",
        },
      });
      throw error;
    } finally {
      this.actionBusy = false;
    }
  }
  async stopSession() {
    if (this.actionBusy || this.snapshot.session.status === "off") return;
    this.actionBusy = true;
    this.publish({
      session: { ...this.snapshot.session, status: "stopping" },
    });
    try {
      const response = await this.request<{ session: ApiSession }>(
        "/api/v1/sessions",
        { method: "DELETE" },
      );
      this.publish({
        session: mapSession(response.session, this.snapshot.settings.gpuId),
        jobs: this.snapshot.jobs.map((job) =>
          ["queued", "running"].includes(job.status)
            ? { ...job, status: "cancelled" as const }
            : job,
        ),
      });
    } finally {
      this.actionBusy = false;
    }
  }
  async extendSession() {
    const response = await this.request<{ session: ApiSession }>(
      "/api/v1/sessions/extend",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ minutes: 30 }),
      },
    );
    this.publish({
      session: mapSession(response.session, this.snapshot.settings.gpuId),
    });
  }
  async generate() {
    if (
      this.actionBusy ||
      this.snapshot.jobs.some((job) => ["queued", "running"].includes(job.status))
    )
      return;
    if (this.snapshot.session.status !== "ready")
      throw new Error("Siapkan sesi worker dan tunggu sampai kontraknya siap.");
    const request = { ...this.snapshot.draft };
    const validation = validateRequest(request, this.snapshot.voices);
    if (validation) throw new Error(validation);
    this.actionBusy = true;
    try {
      const scenario = ["failure", "slow"].includes(this.snapshot.settings.scenario)
        ? this.snapshot.settings.scenario
        : "normal";
      const response = await this.request<{ job: ApiJob }>("/api/v1/jobs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `web_${crypto.randomUUID().replaceAll("-", "")}`,
          "x-demo-scenario": scenario,
        },
        body: JSON.stringify(request),
      });
      this.publish({
        jobs: [
          mapJob(response.job),
          ...this.snapshot.jobs.filter((job) => job.id !== response.job.id),
        ].slice(0, 100),
      });
    } finally {
      this.actionBusy = false;
    }
  }
  async cancelJob(id: string) {
    const response = await this.request<{ job: ApiJob }>(
      `/api/v1/jobs/${encodeURIComponent(id)}/cancel`,
      { method: "POST" },
    );
    const updated = mapJob(response.job);
    this.publish({
      jobs: this.snapshot.jobs.map((job) => (job.id === id ? updated : job)),
    });
  }
  async retrySegment(jobId: string, segmentIndex: number) {
    if (this.actionBusy) return;
    this.actionBusy = true;
    try {
      const response = await this.request<{ job: ApiJob }>(
        `/api/v1/jobs/${encodeURIComponent(jobId)}/segments/${segmentIndex}/retry`,
        { method: "POST" },
      );
      const updated = mapJob(response.job);
      this.publish({
        jobs: this.snapshot.jobs.map((job) =>
          job.id === jobId ? updated : job,
        ),
      });
    } finally {
      this.actionBusy = false;
    }
  }
  async addVoice(voice: Voice, file?: File): Promise<string> {
    if (!file) throw new Error("Berkas referensi diperlukan untuk unggahan server.");
    const form = new FormData();
    form.set("name", voice.name);
    form.set("description", voice.description);
    if (!voice.analysis)
      throw new Error("Laporan kualitas audio diperlukan untuk unggahan server.");
    form.set("analysis", JSON.stringify(voice.analysis));
    form.set("file", file);
    const response = await this.request<{ voice: ApiVoice }>("/api/v1/voices", {
      method: "POST",
      body: form,
    });
    const created = mapVoice(response.voice);
    this.publish({ voices: [...this.snapshot.voices, created] });
    return created.id;
  }
  async editVoice(id: string, name: string, description: string) {
    const response = await this.request<{ voice: ApiVoice }>(
      `/api/v1/voices/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, description }),
      },
    );
    const updated = mapVoice(response.voice);
    this.publish({
      voices: this.snapshot.voices.map((voice) =>
        voice.id === id
          ? {
              ...updated,
              duration: voice.duration,
              analysis: voice.analysis,
            }
          : voice,
      ),
    });
  }
  async removeVoice(id: string) {
    await this.request<void>(`/api/v1/voices/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    this.publish({
      voices: this.snapshot.voices.filter((voice) => voice.id !== id),
      draft:
        this.snapshot.draft.voiceId === id
          ? { ...this.snapshot.draft, voiceId: DEFAULT_DRAFT.voiceId }
          : this.snapshot.draft,
    });
  }
  async resetLocalData() {
    await this.request<{ reset: boolean }>("/api/v1/data", {
      method: "DELETE",
    });
    try {
      localStorage.removeItem(API_STORAGE_KEY);
    } catch {}
    this.publish({
      draft: { ...DEFAULT_DRAFT },
      voices: [...EXAMPLE_VOICES],
      jobs: [],
      session: {
        status: "off",
        startedAt: null,
        expiresAt: null,
        lastActivityAt: null,
        endedAt: Date.now(),
        gpuId: DEFAULT_SETTINGS.gpuId,
      },
      settings: { ...DEFAULT_SETTINGS },
      now: Date.now(),
      storageWarning: null,
    });
  }
  tick() {
    const now = Date.now();
    this.publish({ now });
    const shouldPoll =
      this.snapshot.session.status !== "off" ||
      this.snapshot.jobs.some((job) => ["queued", "running"].includes(job.status));
    if (!shouldPoll || this.pollPromise || now - this.lastPoll < 1000) return;
    this.lastPoll = now;
    this.pollPromise = this.refresh()
      .catch((error) => {
        this.publish({
          storageWarning:
            error instanceof Error
              ? `Pembaruan status API gagal: ${error.message}`
              : "Pembaruan status API gagal.",
        });
      })
      .finally(() => {
        this.pollPromise = null;
      });
  }
  private async refresh() {
    const [sessionResponse, jobsResponse] = await Promise.all([
      this.request<{ session: ApiSession }>("/api/v1/sessions"),
      this.request<{ jobs: ApiJob[] }>("/api/v1/jobs"),
    ]);
    const jobs = await Promise.all(
      jobsResponse.jobs.map(async (job) => {
        if (!["queued", "running"].includes(job.status)) return job;
        const detail = await this.request<{ job: ApiJob }>(
          `/api/v1/jobs/${encodeURIComponent(job.id)}`,
        );
        return detail.job;
      }),
    );
    this.publish({
      session: mapSession(sessionResponse.session, this.snapshot.settings.gpuId),
      jobs: jobs.map(mapJob),
      storageWarning: null,
    });
  }
  async logout() {
    await this.request<{ authenticated: false }>("/api/v1/auth/logout", {
      method: "POST",
    });
  }
  dispose() {
    if (this.settingsTimer) clearTimeout(this.settingsTimer);
    this.settingsTimer = null;
    this.listeners.clear();
  }
}
