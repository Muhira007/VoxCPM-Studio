import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  RunpodControlSession,
  RunpodControlState,
} from "../lib/runpod-control-types.ts";
import { serverConfig } from "./config.ts";

export function emptyRunpodControlSession(): RunpodControlSession {
  return {
    phase: "off",
    podId: null,
    podName: null,
    operationId: null,
    profileId: null,
    cloud: null,
    dataCenterId: null,
    networkVolumeId: null,
    hourlyRate: null,
    startedAt: null,
    hardDeadline: null,
    idleDeadline: null,
    stopRequestedAt: null,
    stopConfirmedAt: null,
    lastVerifiedAt: null,
    workerReady: false,
    retryCount: 0,
    nextRetryAt: null,
    message: "No RunPod cloud session has been created.",
  };
}

function emptyState(): RunpodControlState {
  return {
    version: 1,
    revision: 0,
    session: emptyRunpodControlSession(),
    lease: null,
    operations: [],
  };
}

function isState(value: unknown): value is RunpodControlState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Partial<RunpodControlState>;
  return (
    state.version === 1 &&
    typeof state.revision === "number" &&
    Boolean(state.session && typeof state.session === "object") &&
    Array.isArray(state.operations)
  );
}

export class RunpodControlStore {
  readonly dataDir: string;
  private readonly stateFile: string;
  private initialized = false;
  private initialization: Promise<void> | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(dataDir = serverConfig.dataDir) {
    this.dataDir = resolve(dataDir);
    this.stateFile = join(this.dataDir, "runpod-control.json");
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
    await mkdir(this.dataDir, { recursive: true });
    try {
      await readFile(this.stateFile, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.persist(emptyState());
    }
    this.initialized = true;
  }

  async read(): Promise<RunpodControlState> {
    await this.initialize();
    const parsed: unknown = JSON.parse(await readFile(this.stateFile, "utf8"));
    if (!isState(parsed))
      throw new Error("RunPod control state has an unsupported format.");
    return structuredClone(parsed);
  }

  async mutate<T>(
    operation: (state: RunpodControlState) => T | Promise<T>,
  ): Promise<T> {
    let release!: () => void;
    const turn = new Promise<void>((resolveTurn) => {
      release = resolveTurn;
    });
    const previous = this.queue;
    this.queue = previous.then(
      () => turn,
      () => turn,
    );
    await previous;
    try {
      const state = await this.read();
      const result = await operation(state);
      state.revision += 1;
      state.operations = state.operations.slice(-50);
      await this.persist(state);
      return result;
    } finally {
      release();
    }
  }

  private async persist(state: RunpodControlState): Promise<void> {
    const temporary = `${this.stateFile}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporary, this.stateFile);
  }
}

const globalControlStore = globalThis as typeof globalThis & {
  __voxcpmRunpodControlStore?: RunpodControlStore;
};
export const runpodControlStore =
  globalControlStore.__voxcpmRunpodControlStore ?? new RunpodControlStore();
if (process.env.NODE_ENV !== "production")
  globalControlStore.__voxcpmRunpodControlStore = runpodControlStore;
