import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { serverConfig } from "./config.ts";
import type { ApiSession, PersistedAppState, ServerJob, ServerVoice } from "./contracts";

function emptySession(): ApiSession {
  return { status: "off", startedAt: null, expiresAt: null, endedAt: null, message: "No local worker session is active.", mode: "worker-simulation" };
}

function emptyState(): PersistedAppState {
  return { version: 1, session: emptySession(), jobs: [], voices: [], settings: { sessionMinutes: 60, idleMinutes: 10, maximumHourlyRate: 0.8, gpuProfile: "a5000" } };
}

function isState(value: unknown): value is PersistedAppState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return data.version === 1 && typeof data.session === "object" && Array.isArray(data.jobs) && Array.isArray(data.voices) && typeof data.settings === "object";
}

export class AppStore {
  readonly dataDir: string;
  readonly referencesDir: string;
  readonly outputsDir: string;
  private readonly stateFile: string;
  private initialized = false;
  private initialization: Promise<void> | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(dataDir = serverConfig.dataDir) {
    this.dataDir = resolve(dataDir);
    this.referencesDir = join(this.dataDir, "references");
    this.outputsDir = join(this.dataDir, "outputs");
    this.stateFile = join(this.dataDir, "studio-state.json");
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (!this.initialization) this.initialization = this.initializeOnce();
    try {
      await this.initialization;
    } finally {
      if (!this.initialized) this.initialization = null;
    }
  }

  private async initializeOnce(): Promise<void> {
    await Promise.all([mkdir(this.dataDir, { recursive: true }), mkdir(this.referencesDir, { recursive: true }), mkdir(this.outputsDir, { recursive: true })]);
    try {
      await readFile(this.stateFile, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.persist(emptyState());
    }
    this.initialized = true;
  }

  async read(): Promise<PersistedAppState> {
    await this.initialize();
    const raw = await readFile(this.stateFile, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!isState(parsed)) throw new Error("Server state has an unsupported or invalid format.");
    const state = structuredClone(parsed) as PersistedAppState;
    state.jobs = state.jobs.map((job) => ({
      ...job,
      segments: Array.isArray(job.segments) ? job.segments : [],
    }));
    return state;
  }

  async mutate<T>(operation: (state: PersistedAppState) => T | Promise<T>): Promise<T> {
    let release!: () => void;
    const turn = new Promise<void>((resolveTurn) => { release = resolveTurn; });
    const previous = this.queue;
    this.queue = previous.then(() => turn, () => turn);
    await previous;
    try {
      const state = await this.read();
      const result = await operation(state);
      state.jobs = state.jobs.slice(0, 100);
      await this.persist(state);
      return result;
    } finally {
      release();
    }
  }

  private async persist(state: PersistedAppState): Promise<void> {
    const temporary = `${this.stateFile}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporary, this.stateFile);
  }

  async probe(): Promise<void> {
    await this.initialize();
    const probe = join(this.dataDir, `.write-test-${randomUUID()}`);
    await writeFile(probe, "ok", { encoding: "utf8", flag: "wx" });
    await rm(probe);
  }

  async saveReference(file: File): Promise<string> {
    await this.initialize();
    const extension = basename(file.name).match(/\.[A-Za-z0-9]{2,5}$/)?.[0]?.toLowerCase() || ".audio";
    const storageName = `${randomUUID()}${extension}`;
    const destination = this.referencePath(storageName);
    await writeFile(destination, Buffer.from(await file.arrayBuffer()), { flag: "wx" });
    return storageName;
  }

  referencePath(storageName: string): string {
    if (!/^[A-Za-z0-9-]+\.[A-Za-z0-9]{2,5}$/.test(storageName)) throw new Error("Invalid reference storage name.");
    const destination = resolve(this.referencesDir, storageName);
    if (!destination.startsWith(`${resolve(this.referencesDir)}\\`) && !destination.startsWith(`${resolve(this.referencesDir)}/`)) throw new Error("Reference path escaped its storage directory.");
    return destination;
  }

  outputPath(storageName: string): string {
    if (!/^job_[A-Za-z0-9_-]{8,100}\.wav$/.test(storageName)) throw new Error("Invalid output storage name.");
    const destination = resolve(this.outputsDir, storageName);
    const relation = relative(resolve(this.outputsDir), destination);
    if (!relation || relation.startsWith("..") || isAbsolute(relation)) throw new Error("Output path escaped its storage directory.");
    return destination;
  }

  async saveOutput(jobId: string, audio: Uint8Array): Promise<string> {
    await this.initialize();
    const storageName = `${jobId}.wav`;
    const destination = this.outputPath(storageName);
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, audio, { flag: "wx" });
      await rm(destination, { force: true });
      await rename(temporary, destination);
    } finally {
      await rm(temporary, { force: true });
    }
    return storageName;
  }

  async clearOutputs(): Promise<void> {
    const relation = relative(resolve(this.dataDir), resolve(this.outputsDir));
    if (!relation || relation.startsWith("..") || isAbsolute(relation)) throw new Error("Output directory escaped application storage.");
    await rm(this.outputsDir, { recursive: true, force: true });
    await mkdir(this.outputsDir, { recursive: true });
  }

  async removeReference(voice: ServerVoice): Promise<void> {
    await rm(this.referencePath(voice.storageName), { force: true });
  }

  async replaceSession(session: ApiSession): Promise<ApiSession> {
    return this.mutate((state) => { state.session = session; return structuredClone(session); });
  }

  async addJob(job: ServerJob): Promise<ServerJob> {
    return this.mutate((state) => { state.jobs.unshift(job); return structuredClone(job); });
  }

  async updateJob(id: string, patch: Partial<ServerJob>): Promise<ServerJob | null> {
    return this.mutate((state) => {
      const index = state.jobs.findIndex((job) => job.id === id);
      if (index < 0) return null;
      state.jobs[index] = { ...state.jobs[index], ...patch, id: state.jobs[index].id };
      return structuredClone(state.jobs[index]);
    });
  }

  async addVoice(voice: ServerVoice): Promise<ServerVoice> {
    return this.mutate((state) => { state.voices.push(voice); return structuredClone(voice); });
  }

  async removeVoice(id: string): Promise<ServerVoice | null> {
    return this.mutate((state) => {
      const voice = state.voices.find((item) => item.id === id);
      if (!voice) return null;
      state.voices = state.voices.filter((item) => item.id !== id);
      return structuredClone(voice);
    });
  }
}

const globalStore = globalThis as typeof globalThis & { __voxcpmAppStore?: AppStore };
export const appStore = globalStore.__voxcpmAppStore ?? new AppStore();
if (process.env.NODE_ENV !== "production") globalStore.__voxcpmAppStore = appStore;
