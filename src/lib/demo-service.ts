import {
  DEFAULT_DRAFT,
  DEFAULT_SETTINGS,
  EXAMPLE_VOICES,
  GPU_PROFILES,
} from "./fixtures.ts";
import type {
  AppSettings,
  StudioService,
  StudioSnapshot,
  SynthesisJob,
  SynthesisRequest,
  Voice,
} from "./types.ts";
import { compileExpressionScript } from "./expression-script.ts";

type Timer = ReturnType<typeof setTimeout>;
export interface Runtime {
  now(): number;
  schedule(callback: () => void, delay: number): Timer;
  clear(timer: Timer): void;
}
const defaultRuntime: Runtime = {
  now: () => Date.now(),
  schedule: (callback, delay) => setTimeout(callback, delay),
  clear: (timer) => clearTimeout(timer),
};
const emptySession = () => ({
  status: "off" as const,
  startedAt: null,
  expiresAt: null,
  lastActivityAt: null,
  endedAt: null,
  gpuId: "a5000",
});
export const STORAGE_KEY = "voxcpm-studio:v1";
export const MAX_TEXT = 5000;

export function validateRequest(
  request: SynthesisRequest,
  voices: Voice[],
): string | null {
  if (!request.text.trim()) return "Tulis naskah terlebih dahulu.";
  if (request.text.length > MAX_TEXT)
    return "Naskah dibatasi 5.000 karakter per pekerjaan demo.";
  const expression = compileExpressionScript(request.text);
  const expressionError = expression.issues.find(
    (issue) => issue.severity === "error",
  );
  if (expressionError) return expressionError.message;
  if (expression.hasExpressionTags && request.mode === "hifi")
    return "Hi-Fi mengabaikan instruksi ekspresi. Gunakan Voice Cloning agar ekspresi dapat diarahkan.";
  if (request.mode === "design" && !request.description.trim())
    return "Isi deskripsi karakter suara yang ingin dibuat.";
  if (request.mode === "clone" || request.mode === "hifi") {
    const reference = voices.find((voice) => voice.id === request.voiceId);
    if (!reference || reference.source !== "upload")
      return "Tambahkan rekaman referensi dari Pustaka Suara untuk mode cloning.";
  }
  if (request.mode === "hifi" && !request.transcript.trim())
    return "Hi-Fi memerlukan transkrip yang sesuai dengan rekaman referensi.";
  return null;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function validDraft(value: unknown): value is SynthesisRequest {
  return (
    record(value) &&
    typeof value.text === "string" &&
    value.text.length <= MAX_TEXT &&
    ["tts", "design", "clone", "hifi"].includes(String(value.mode)) &&
    ["natural", "calm", "cheerful", "dramatic"].includes(String(value.style)) &&
    typeof value.voiceId === "string" &&
    typeof value.description === "string" &&
    typeof value.transcript === "string"
  );
}
function validVoice(value: unknown): value is Voice {
  return (
    record(value) &&
    typeof value.id === "string" &&
    !value.id.startsWith("example-") &&
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    value.source === "upload" &&
    ["orange", "purple", "blue", "green"].includes(String(value.color)) &&
    typeof value.createdAt === "number" &&
    typeof value.duration === "number" &&
    Number.isFinite(value.duration) &&
    value.duration > 0 &&
    typeof value.fileName === "string"
  );
}
function validJob(value: unknown): value is SynthesisJob {
  return (
    record(value) &&
    typeof value.id === "string" &&
    validDraft(value.request) &&
    typeof value.voiceName === "string" &&
    typeof value.createdAt === "number" &&
    ["queued", "running", "succeeded", "failed", "cancelled"].includes(
      String(value.status),
    ) &&
    typeof value.progress === "number" &&
    Number.isFinite(value.progress) &&
    (value.message === undefined || typeof value.message === "string")
  );
}
function normalizedSettings(value: Partial<AppSettings>): AppSettings {
  const minutes = Number(value.sessionMinutes);
  const idle = Number(value.idleMinutes);
  const price = Number(value.maxHourlyRate);
  return {
    sessionMinutes: [30, 60, 120, 240].includes(minutes) ? minutes : 60,
    idleMinutes: [5, 10, 15, 30].includes(idle) ? idle : 10,
    maxHourlyRate:
      Number.isFinite(price) && price >= 0.01 && price <= 10 ? price : 0.8,
    gpuId: GPU_PROFILES.some((gpu) => gpu.id === value.gpuId)
      ? value.gpuId!
      : "a5000",
    scenario: [
      "normal",
      "unavailable",
      "slow",
      "failure",
      "disconnected",
    ].includes(String(value.scenario))
      ? value.scenario!
      : "normal",
  };
}

// This adapter never contacts RunPod or creates AI audio. Replace behind StudioService later.
export class DemoStudioService implements StudioService {
  readonly mode = "demo" as const;
  private snapshot: StudioSnapshot = {
    hydrated: false,
    draft: { ...DEFAULT_DRAFT },
    voices: [...EXAMPLE_VOICES],
    jobs: [],
    session: emptySession(),
    settings: { ...DEFAULT_SETTINGS },
    now: 0,
    storageWarning: null,
  };
  private listeners = new Set<() => void>();
  private sessionTimers: Timer[] = [];
  private jobTimers: Timer[] = [];
  private activeRequestKey: string | null = null;
  private runtime: Runtime;

  constructor(runtime: Runtime = defaultRuntime) {
    this.runtime = runtime;
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<StudioSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private clearTimers(timers: Timer[]) {
    timers.forEach((timer) => this.runtime.clear(timer));
    timers.length = 0;
  }
  private changeSession(patch: Partial<StudioSnapshot["session"]>) {
    this.publish({
      session: { ...this.snapshot.session, ...patch },
      now: this.runtime.now(),
    });
  }
  private updateJob(id: string, patch: Partial<SynthesisJob>) {
    this.publish({
      jobs: this.snapshot.jobs.map((job) =>
        job.id === id ? { ...job, ...patch } : job,
      ),
    });
  }

  hydrate(serialized: string | null) {
    if (this.snapshot.hydrated) return;
    let warning: string | null = null;
    try {
      const data: unknown = serialized ? JSON.parse(serialized) : null;
      if (data !== null) {
        if (
          !record(data) ||
          data.version !== 1 ||
          !validDraft(data.draft) ||
          !record(data.settings) ||
          !Array.isArray(data.voices) ||
          !Array.isArray(data.jobs)
        )
          throw new Error("Invalid local data");
        const voices = [...EXAMPLE_VOICES, ...data.voices.filter(validVoice)];
        const draft = { ...data.draft };
        if (draft.mode === "hifi") draft.style = "natural";
        if (!voices.some((voice) => voice.id === draft.voiceId))
          draft.voiceId = DEFAULT_DRAFT.voiceId;
        this.snapshot = {
          ...this.snapshot,
          draft,
          voices,
          settings: normalizedSettings(data.settings),
          jobs: data.jobs
            .filter(validJob)
            .slice(0, 100)
            .map((job) => ({
              ...job,
              segments: Array.isArray(job.segments) ? job.segments : [],
              audioUrl: null,
              audioDuration: null,
              message: ["queued", "running"].includes(job.status)
                ? "Simulasi dihentikan karena halaman dimuat ulang. Gunakan ulang naskah untuk mencoba lagi."
                : job.message,
              status: ["queued", "running"].includes(job.status)
                ? "cancelled"
                : job.status,
            })),
        };
      }
    } catch {
      warning =
        "Data lokal tidak dapat dibaca. Ruang kerja dibuka dengan pengaturan awal.";
    }
    this.publish({
      hydrated: true,
      now: this.runtime.now(),
      storageWarning: warning,
      session: emptySession(),
    });
  }
  serialize() {
    return JSON.stringify({
      version: 1,
      draft: this.snapshot.draft,
      settings: this.snapshot.settings,
      voices: this.snapshot.voices.filter((voice) => voice.source === "upload"),
      jobs: this.snapshot.jobs.slice(0, 100),
    });
  }
  reportStorageWarning(message: string) {
    if (message !== this.snapshot.storageWarning)
      this.publish({ storageWarning: message });
  }
  updateDraft(patch: Partial<SynthesisRequest>) {
    const next = { ...this.snapshot.draft, ...patch };
    if (!validDraft(next)) throw new Error("Pengaturan naskah tidak valid.");
    if (next.mode === "hifi") next.style = "natural";
    this.publish({ draft: next });
  }
  updateSettings(patch: Partial<AppSettings>) {
    this.publish({
      settings: normalizedSettings({ ...this.snapshot.settings, ...patch }),
    });
  }
  addVoice(voice: Voice) {
    this.publish({ voices: [...this.snapshot.voices, voice] });
    return voice.id;
  }
  editVoice(id: string, name: string, description: string) {
    this.publish({
      voices: this.snapshot.voices.map((voice) =>
        voice.id === id && voice.source === "upload"
          ? { ...voice, name, description }
          : voice,
      ),
    });
  }
  removeVoice(id: string) {
    this.publish({
      voices: this.snapshot.voices.filter(
        (voice) => voice.id !== id || voice.source === "example",
      ),
      draft:
        this.snapshot.draft.voiceId === id
          ? { ...this.snapshot.draft, voiceId: DEFAULT_DRAFT.voiceId }
          : this.snapshot.draft,
    });
  }
  resetLocalData() {
    this.dispose();
    this.activeRequestKey = null;
    this.publish({
      draft: { ...DEFAULT_DRAFT },
      voices: [...EXAMPLE_VOICES],
      jobs: [],
      session: emptySession(),
      settings: { ...DEFAULT_SETTINGS },
      now: this.runtime.now(),
      storageWarning: null,
    });
  }
  startSession() {
    if (!this.snapshot.hydrated) return;
    if (!["off", "error"].includes(this.snapshot.session.status)) return;
    const settings = this.snapshot.settings;
    const gpu = GPU_PROFILES.find((item) => item.id === settings.gpuId)!;
    if (gpu.rate > settings.maxHourlyRate)
      throw new Error(
        "Tarif contoh GPU ini melebihi batas harga. Pilih profil lain atau ubah batas di Pengaturan.",
      );
    this.clearTimers(this.sessionTimers);
    const now = this.runtime.now();
    this.changeSession({
      status: "provisioning",
      startedAt: now,
      expiresAt: now + settings.sessionMinutes * 60000,
      lastActivityAt: now,
      endedAt: null,
      gpuId: gpu.id,
      message: undefined,
    });
    const scenario = settings.scenario;
    this.sessionTimers.push(
      this.runtime.schedule(() => {
        if (scenario === "unavailable") {
          this.changeSession({
            status: "error",
            message:
              "Skenario demo: GPU tidak tersedia. Ubah skenario di Pengaturan untuk mencoba lagi.",
            endedAt: this.runtime.now(),
          });
          return;
        }
        this.changeSession({ status: "loading" });
        this.sessionTimers.push(
          this.runtime.schedule(
            () =>
              this.changeSession({
                status: "ready",
                lastActivityAt: this.runtime.now(),
              }),
            scenario === "slow" ? 9000 : 1500,
          ),
        );
      }, 1100),
    );
  }
  stopSession() {
    if (
      this.snapshot.session.status === "off" ||
      this.snapshot.session.status === "stopping"
    )
      return;
    this.clearTimers(this.sessionTimers);
    this.clearTimers(this.jobTimers);
    this.activeRequestKey = null;
    this.publish({
      jobs: this.snapshot.jobs.map((job) =>
        ["queued", "running"].includes(job.status)
          ? {
              ...job,
              status: "cancelled",
              message: "Pekerjaan dibatalkan karena sesi demo berakhir.",
            }
          : job,
      ),
    });
    this.changeSession({ status: "stopping", endedAt: this.runtime.now() });
    this.sessionTimers.push(
      this.runtime.schedule(
        () =>
          this.changeSession({
            status: "off",
            expiresAt: null,
            message: undefined,
          }),
        650,
      ),
    );
  }
  extendSession() {
    const session = this.snapshot.session;
    if (
      session.expiresAt === null ||
      !["provisioning", "loading", "ready"].includes(session.status)
    )
      return;
    const max = session.startedAt! + 4 * 60 * 60000;
    const next = Math.min(session.expiresAt + 30 * 60000, max);
    if (next <= session.expiresAt)
      throw new Error("Sesi sudah mencapai batas maksimum demo empat jam.");
    this.changeSession({ expiresAt: next });
  }
  tick() {
    const now = this.runtime.now();
    const session = this.snapshot.session;
    this.publish({ now });
    if (!["provisioning", "loading", "ready"].includes(session.status)) return;
    const busy = this.snapshot.jobs.some((job) =>
      ["queued", "running"].includes(job.status),
    );
    if (session.expiresAt !== null && now >= session.expiresAt)
      this.stopSession();
    else if (
      session.status === "ready" &&
      !busy &&
      session.lastActivityAt !== null &&
      now - session.lastActivityAt >= this.snapshot.settings.idleMinutes * 60000
    )
      this.stopSession();
  }
  generate() {
    // Synchronous guard prevents double clicks and stale component state from duplicating work.
    if (
      this.activeRequestKey ||
      this.snapshot.jobs.some((job) =>
        ["queued", "running"].includes(job.status),
      )
    )
      return;
    if (this.snapshot.session.status !== "ready")
      throw new Error("Siapkan sesi demo dan tunggu sampai model siap.");
    const request = { ...this.snapshot.draft };
    const error = validateRequest(request, this.snapshot.voices);
    if (error) throw new Error(error);
    const id = `demo-${this.runtime.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.activeRequestKey = id;
    const voiceName =
      request.mode === "design"
        ? "Voice Design"
        : request.mode === "tts"
          ? "Suara bawaan (demo)"
          : (this.snapshot.voices.find((voice) => voice.id === request.voiceId)
              ?.name ?? "Referensi");
    const compiled = compileExpressionScript(request.text);
    const segments = compiled.hasExpressionTags
      ? compiled.segments.map((segment) => ({
          ...segment,
          tags: [...segment.tags],
          status: "queued" as const,
          progress: 0,
          message: "Menunggu simulasi segmen.",
          audioDuration: null,
        }))
      : [];
    const job: SynthesisJob = {
      id,
      request,
      voiceName,
      createdAt: this.runtime.now(),
      status: "queued",
      progress: 0,
      audioUrl: null,
      audioDuration: null,
      segments,
    };
    this.publish({ jobs: [job, ...this.snapshot.jobs].slice(0, 100) });
    this.changeSession({ lastActivityAt: this.runtime.now() });
    const scenario = this.snapshot.settings.scenario;
    this.jobTimers.push(
      this.runtime.schedule(
        () =>
          this.updateJob(id, {
            status: "running",
            progress: 25,
            segments: segments.map((segment, index) =>
              index === 0
                ? {
                    ...segment,
                    status: "running",
                    progress: 25,
                    message: "Simulasi segmen sedang berjalan.",
                  }
                : segment,
            ),
          }),
        550,
      ),
    );
    this.jobTimers.push(
      this.runtime.schedule(() => this.updateJob(id, { progress: 68 }), 1600),
    );
    this.jobTimers.push(
      this.runtime.schedule(() => {
        this.activeRequestKey = null;
        if (scenario === "failure" || scenario === "disconnected") {
          this.updateJob(id, {
            status: "failed",
            segments: segments.map((segment, index) =>
              index === 0
                ? {
                    ...segment,
                    status: "failed",
                    progress: 70,
                    message: "Skenario demo: segmen gagal diproses.",
                  }
                : segment,
            ),
            message:
              scenario === "failure"
                ? "Skenario demo: sintesis gagal. Naskah tetap tersimpan dan dapat dicoba ulang."
                : "Skenario demo: koneksi worker terputus. Naskah tetap tersedia di riwayat.",
          });
          if (scenario === "disconnected")
            this.changeSession({
              status: "error",
              message:
                "Koneksi demo terputus. Mulai ulang sesi untuk melanjutkan.",
              endedAt: this.runtime.now(),
            });
        } else
          this.updateJob(id, {
            status: "succeeded",
            progress: 100,
            message: "Alur demo selesai. Belum ada audio AI yang dihasilkan.",
            segments: segments.map((segment) => ({
              ...segment,
              status: "succeeded",
              progress: 100,
              message: "Kontrak segmen berhasil disimulasikan tanpa audio.",
            })),
          });
        this.changeSession({ lastActivityAt: this.runtime.now() });
      }, 2900),
    );
  }
  cancelJob(id: string) {
    const job = this.snapshot.jobs.find((item) => item.id === id);
    if (!job || !["queued", "running"].includes(job.status)) return;
    this.clearTimers(this.jobTimers);
    this.activeRequestKey = null;
    this.updateJob(id, {
      status: "cancelled",
      message: "Pekerjaan demo dibatalkan. Naskah tetap tersimpan.",
      segments: job.segments.map((segment) =>
        ["queued", "running"].includes(segment.status)
          ? {
              ...segment,
              status: "cancelled",
              message: "Segmen dibatalkan bersama pekerjaannya.",
            }
          : segment,
      ),
    });
    this.changeSession({ lastActivityAt: this.runtime.now() });
  }
  retrySegment(jobId: string, segmentIndex: number) {
    const job = this.snapshot.jobs.find((item) => item.id === jobId);
    const segment = job?.segments.find((item) => item.index === segmentIndex);
    if (!job || !segment) throw new Error("Segmen tidak ditemukan.");
    if (
      this.snapshot.jobs.some((item) =>
        ["queued", "running"].includes(item.status),
      )
    )
      throw new Error("Tunggu pekerjaan aktif selesai sebelum mengulang segmen.");
    this.updateJob(jobId, {
      status: "succeeded",
      progress: 100,
      message: "Retry segmen berhasil disimulasikan tanpa audio.",
      segments: job.segments.map((item) =>
        item.index === segmentIndex
          ? {
              ...item,
              status: "succeeded",
              progress: 100,
              message: "Retry segmen berhasil disimulasikan tanpa audio.",
            }
          : item,
      ),
    });
  }
  dispose() {
    this.clearTimers(this.sessionTimers);
    this.clearTimers(this.jobTimers);
  }
  logout() {}
}
