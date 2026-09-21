import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  RunpodControlSession,
  RunpodControlState,
} from "../lib/runpod-control-types.ts";
import { serverConfig } from "./config.ts";

const FILE_LOCK_RETRY_MILLISECONDS = 25;
const FILE_LOCK_TIMEOUT_MILLISECONDS = 10_000;
const FILE_LOCK_STALE_MILLISECONDS = 60_000;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

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
  private readonly lockFile: string;
  private initialized = false;
  private initialization: Promise<void> | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(dataDir = serverConfig.dataDir) {
    this.dataDir = resolve(dataDir);
    this.stateFile = join(this.dataDir, "runpod-control.json");
    this.lockFile = join(this.dataDir, "runpod-control.lock");
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
    const releaseFileLock = await this.acquireFileLock();
    try {
      await readFile(this.stateFile, "utf8");
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
      await this.persist(emptyState());
    } finally {
      await releaseFileLock();
    }
    this.initialized = true;
  }

  async read(): Promise<RunpodControlState> {
    await this.initialize();
    return this.readStateFile();
  }

  private async readStateFile(): Promise<RunpodControlState> {
    const parsed: unknown = JSON.parse(await readFile(this.stateFile, "utf8"));
    if (!isState(parsed))
      throw new Error("RunPod control state has an unsupported format.");
    return structuredClone(parsed);
  }

  async mutate<T>(
    operation: (state: RunpodControlState) => T | Promise<T>,
  ): Promise<T> {
    await this.initialize();
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
    let releaseFileLock: (() => Promise<void>) | null = null;
    try {
      releaseFileLock = await this.acquireFileLock();
      const state = await this.readStateFile();
      const result = await operation(state);
      state.revision += 1;
      state.operations = state.operations.slice(-50);
      await this.persist(state);
      return result;
    } finally {
      try {
        if (releaseFileLock) await releaseFileLock();
      } finally {
        release();
      }
    }
  }

  private async acquireFileLock(): Promise<() => Promise<void>> {
    const owner = `${process.pid}-${randomUUID()}`;
    const deadline = Date.now() + FILE_LOCK_TIMEOUT_MILLISECONDS;
    while (true) {
      try {
        const handle = await open(this.lockFile, "wx");
        try {
          await handle.writeFile(
            `${JSON.stringify({ owner, createdAt: new Date().toISOString() })}\n`,
            "utf8",
          );
          await handle.sync();
        } catch (error) {
          await handle.close().catch(() => undefined);
          await rm(this.lockFile, { force: true }).catch(() => undefined);
          throw error;
        }
        return async () => {
          await handle.close();
          await rm(this.lockFile, { force: true });
        };
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw error;
        await this.recoverStaleFileLock();
        if (Date.now() >= deadline)
          throw new Error(
            "Timed out waiting for the RunPod control state lock.",
          );
        await wait(FILE_LOCK_RETRY_MILLISECONDS);
      }
    }
  }

  private async recoverStaleFileLock(): Promise<void> {
    let metadata;
    try {
      metadata = await stat(this.lockFile);
    } catch (error) {
      if (errorCode(error) === "ENOENT") return;
      throw error;
    }
    if (Date.now() - metadata.mtimeMs <= FILE_LOCK_STALE_MILLISECONDS) return;
    const quarantine = `${this.lockFile}.stale.${randomUUID()}`;
    try {
      await rename(this.lockFile, quarantine);
      await rm(quarantine, { force: true });
    } catch (error) {
      if (!["ENOENT", "EACCES", "EPERM"].includes(errorCode(error) || ""))
        throw error;
    }
  }

  private async persist(state: RunpodControlState): Promise<void> {
    const temporary = `${this.stateFile}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
      await rename(temporary, this.stateFile);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}

const globalControlStore = globalThis as typeof globalThis & {
  __voxcpmRunpodControlStore?: RunpodControlStore;
};
export const runpodControlStore =
  globalControlStore.__voxcpmRunpodControlStore ?? new RunpodControlStore();
if (process.env.NODE_ENV !== "production")
  globalControlStore.__voxcpmRunpodControlStore = runpodControlStore;
