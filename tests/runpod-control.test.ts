import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import type { RunpodOverview } from "../src/lib/runpod-types.ts";
import type {
  CreateRunpodPodInput,
  ManagedRunpodPod,
  RunpodControlGateway,
} from "../src/server/runpod-control-gateway.ts";
import { RunpodRestControlGateway } from "../src/server/runpod-control-gateway.ts";
import {
  RunpodController,
  type RunpodControllerConfig,
  type RunpodWorkloadSnapshot,
} from "../src/server/runpod-controller.ts";
import { RunpodControlStore } from "../src/server/runpod-control-store.ts";
import { runRunpodWatchdogOnce } from "../src/server/runpod-watchdog-runner.ts";

const image =
  "ghcr.io/muhira007/voxcpm-studio-worker@sha256:90ba964343f769a428259a59ac0acd8523de82c02f4ffddd82e2e8d78d715fbd";

const config: RunpodControllerConfig = {
  apiKey: "runpod_control_key_for_tests_123456789",
  writeEnabled: true,
  workerImage: image,
  workerApiKey: "worker_control_key_for_tests_123456789",
  cloud: "secure",
  dataCenterId: "EU-CZ-1",
  networkVolumeId: "volume_test_001",
  hardCostLimitUsd: 1,
  maximumSessionMinutes: 240,
};

function idleWorkload(value: Partial<RunpodWorkloadSnapshot> = {}): {
  snapshot: () => Promise<RunpodWorkloadSnapshot>;
} {
  return {
    snapshot: async () => ({
      runningJobCount: 0,
      queuedJobCount: 0,
      lastActivityAt: null,
      idleMinutes: 10,
      ...value,
    }),
  };
}

function managedPod(
  status: ManagedRunpodPod["status"] = "PROVISIONING",
  overrides: Partial<ManagedRunpodPod> = {},
): ManagedRunpodPod {
  return {
    id: "pod-test-001",
    name: "voxcpm-studio-test",
    status,
    image,
    gpuId: "NVIDIA GeForce RTX 3090",
    cloud: "secure",
    dataCenterId: "EU-CZ-1",
    hourlyRate: 0.5,
    actions: ["stop"],
    locked: false,
    ...overrides,
  };
}

function overview(hourlyRate = 0.5, dataCenters = ["EU-CZ-1"]): RunpodOverview {
  return {
    mode: "read-only",
    observedAt: "2026-09-21T00:00:00.000Z",
    source: "RunPod REST API v2",
    minimumCudaVersion: "12.8",
    writesEnabled: false,
    mutationAttempted: false,
    inventory: { podCount: 0, pods: [] },
    catalog: {
      gpuTypeCount: 1,
      dataCenterCount: 1,
      dataCenters: [],
      profiles: [
        {
          profileId: "3090",
          runpodId: "NVIDIA GeForce RTX 3090",
          name: "RTX 3090",
          memoryGb: 24,
          cudaVersions: ["12.8"],
          offers: {
            community: {
              hourlyRate: 0.22,
              availability: "MEDIUM",
              dataCenters,
            },
            secure: {
              hourlyRate,
              availability: "MEDIUM",
              dataCenters,
            },
          },
        },
      ],
    },
  };
}

class FakeGateway implements RunpodControlGateway {
  pods: ManagedRunpodPod[];
  createCalls = 0;
  startCalls = 0;
  stopCalls = 0;
  stopFailures = 0;
  stopResultStatus: ManagedRunpodPod["status"] = "EXITED";

  constructor(pods: ManagedRunpodPod[] = []) {
    this.pods = structuredClone(pods);
  }

  async listPods() {
    return structuredClone(this.pods);
  }

  async getPod(id: string) {
    return structuredClone(this.pods.find((pod) => pod.id === id) ?? null);
  }

  async createPod(input: CreateRunpodPodInput) {
    this.createCalls += 1;
    const pod = managedPod("PROVISIONING", {
      name: input.name,
      image: input.image,
      gpuId: input.gpuId,
      cloud: input.cloud,
      dataCenterId: input.dataCenterId,
    });
    this.pods = [pod];
    return structuredClone(pod);
  }

  async startPod(id: string) {
    this.startCalls += 1;
    const pod = this.pods.find((item) => item.id === id);
    assert.ok(pod);
    pod.status = "STARTING";
    return structuredClone(pod);
  }

  async stopPod(id: string) {
    this.stopCalls += 1;
    if (this.stopFailures > 0) {
      this.stopFailures -= 1;
      throw new Error("simulated stop failure");
    }
    const pod = this.pods.find((item) => item.id === id);
    assert.ok(pod);
    pod.status = this.stopResultStatus;
    return structuredClone(pod);
  }
}

async function temporaryStore() {
  const directory = await mkdtemp(join(tmpdir(), "voxcpm-runpod-control-"));
  return { directory, store: new RunpodControlStore(directory) };
}

async function removeTemporary(directory: string) {
  const root = resolve(tmpdir());
  const target = resolve(directory);
  assert.ok(
    target.startsWith(root) && target.includes("voxcpm-runpod-control-"),
  );
  await rm(target, { recursive: true, force: true });
}

test("disabled RunPod write gateway rejects mutations before fetch", async () => {
  let fetchCalls = 0;
  const gateway = new RunpodRestControlGateway({
    apiKey: config.apiKey,
    baseUrl: "https://api.runpod.test/v2",
    writeEnabled: false,
    fetcher: async () => {
      fetchCalls += 1;
      throw new Error("fetch must not run");
    },
  });

  await assert.rejects(
    gateway.createPod({
      name: "voxcpm-studio-locked",
      image,
      gpuId: "NVIDIA GeForce RTX 3090",
      cloud: "secure",
      dataCenterId: "EU-CZ-1",
      networkVolumeId: "volume_test_001",
      workerApiKey: config.workerApiKey,
    }),
    /write operations are disabled/,
  );
  await assert.rejects(gateway.startPod("pod-test-001"), /disabled/);
  await assert.rejects(gateway.stopPod("pod-test-001"), /disabled/);
  assert.equal(fetchCalls, 0);
  assert.equal("terminatePod" in gateway, false);
});

test("enabled gateway creates a Pod with pinned image and persistent network mount", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const gateway = new RunpodRestControlGateway({
    apiKey: config.apiKey,
    baseUrl: "https://api.runpod.test/v2",
    writeEnabled: true,
    fetcher: async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(
        JSON.stringify(
          managedPod(
            init?.body?.toString().includes('"action":"stop"')
              ? "EXITED"
              : "PROVISIONING",
          ),
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  await gateway.createPod({
    name: "voxcpm-studio-payload",
    image,
    gpuId: "NVIDIA GeForce RTX 3090",
    cloud: "secure",
    dataCenterId: "EU-CZ-1",
    networkVolumeId: "volume_test_001",
    workerApiKey: config.workerApiKey,
  });
  await gateway.stopPod("pod-test-001");

  const createBody = JSON.parse(String(calls[0].init?.body));
  assert.equal(calls[0].init?.method, "POST");
  assert.equal(createBody.image, image);
  assert.deepEqual(createBody.gpu, {
    id: "NVIDIA GeForce RTX 3090",
    count: 1,
    minCudaVersion: "12.8",
  });
  assert.deepEqual(createBody.mounts.network, [
    { volumeId: "volume_test_001", path: "/workspace" },
  ]);
  assert.equal(createBody.disk, 20);
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)), { action: "stop" });
});

test("controller creates once, reconciles readiness, and verifies stop", async () => {
  const { directory, store } = await temporaryStore();
  try {
    const gateway = new FakeGateway();
    const controller = new RunpodController({
      store,
      gateway,
      catalog: { overview: async () => overview() },
      config,
      now: () => new Date("2026-09-21T01:00:00.000Z"),
      workerProbe: async () => true,
    });
    const input = {
      operationId: "operation_start_0001",
      profileId: "3090" as const,
      durationMinutes: 60,
      maximumHourlyRate: 0.6,
    };

    const started = await controller.start(input);
    assert.equal(gateway.createCalls, 1);
    assert.equal(started.session.phase, "provisioning");
    assert.equal(started.session.hardDeadline, "2026-09-21T02:00:00.000Z");

    const repeated = await controller.start(input);
    assert.equal(repeated.session.podId, started.session.podId);
    assert.equal(gateway.createCalls, 1);

    gateway.pods[0].status = "RUNNING";
    const ready = await controller.reconcile();
    assert.equal(ready.session.phase, "ready");
    assert.equal(ready.session.workerReady, true);

    const stopped = await controller.stop({
      operationId: "operation_stop_00001",
    });
    assert.equal(gateway.stopCalls, 1);
    assert.equal(stopped.session.phase, "stopped");
    assert.equal(stopped.session.stopConfirmedAt, "2026-09-21T01:00:00.000Z");
  } finally {
    await removeTemporary(directory);
  }
});

test("controller resumes one exited managed Pod instead of creating another", async () => {
  const { directory, store } = await temporaryStore();
  try {
    const gateway = new FakeGateway([managedPod("EXITED")]);
    const controller = new RunpodController({
      store,
      gateway,
      catalog: { overview: async () => overview() },
      config,
      now: () => new Date("2026-09-21T01:00:00.000Z"),
    });
    const state = await controller.start({
      operationId: "operation_resume_001",
      profileId: "3090",
      durationMinutes: 30,
      maximumHourlyRate: 0.6,
    });

    assert.equal(gateway.createCalls, 0);
    assert.equal(gateway.startCalls, 1);
    assert.equal(state.session.phase, "starting");
    assert.equal(state.session.podId, "pod-test-001");
  } finally {
    await removeTemporary(directory);
  }
});

test("controller never repeats a create while its network outcome is unknown", async () => {
  const { directory, store } = await temporaryStore();
  try {
    class AmbiguousCreateGateway extends FakeGateway {
      override async createPod(): Promise<ManagedRunpodPod> {
        this.createCalls += 1;
        throw new Error("simulated response timeout after create");
      }
    }
    const gateway = new AmbiguousCreateGateway();
    const controller = new RunpodController({
      store,
      gateway,
      catalog: { overview: async () => overview() },
      config,
      now: () => new Date("2026-09-21T01:00:00.000Z"),
    });
    const input = {
      operationId: "operation_ambiguous_1",
      profileId: "3090" as const,
      durationMinutes: 30,
      maximumHourlyRate: 0.6,
    };

    await assert.rejects(controller.start(input), /response timeout/);
    const failed = await store.read();
    assert.equal(
      failed.operations[0].mutationAttemptedAt,
      "2026-09-21T01:00:00.000Z",
    );
    const restartedController = new RunpodController({
      store: new RunpodControlStore(directory),
      gateway,
      catalog: { overview: async () => overview() },
      config,
      now: () => new Date("2026-09-21T01:00:00.000Z"),
    });
    await assert.rejects(
      restartedController.start(input),
      /outcome is still unknown/,
    );
    assert.equal(gateway.createCalls, 1);
  } finally {
    await removeTemporary(directory);
  }
});

test("restarted controller adopts a Pod that appears after an ambiguous create", async () => {
  const { directory, store } = await temporaryStore();
  try {
    class VisibleAmbiguousCreateGateway extends FakeGateway {
      override async createPod(
        input: CreateRunpodPodInput,
      ): Promise<ManagedRunpodPod> {
        this.createCalls += 1;
        this.pods = [
          managedPod("PROVISIONING", {
            name: input.name,
            image: input.image,
            gpuId: input.gpuId,
          }),
        ];
        throw new Error("simulated lost create response");
      }
    }
    const gateway = new VisibleAmbiguousCreateGateway();
    const dependencies = {
      gateway,
      catalog: { overview: async () => overview() },
      config,
      now: () => new Date("2026-09-21T01:00:00.000Z"),
    };
    const input = {
      operationId: "operation_restart_0001",
      profileId: "3090" as const,
      durationMinutes: 30,
      maximumHourlyRate: 0.6,
    };
    await assert.rejects(
      new RunpodController({ store, ...dependencies }).start(input),
      /lost create response/,
    );

    const recovered = await new RunpodController({
      store: new RunpodControlStore(directory),
      ...dependencies,
    }).start(input);
    assert.equal(gateway.createCalls, 1);
    assert.equal(recovered.session.podId, "pod-test-001");
    assert.equal(recovered.session.phase, "provisioning");
    assert.equal(recovered.operations[0].status, "succeeded");
  } finally {
    await removeTemporary(directory);
  }
});

test("controller enforces live rate, data center, and hard cost before mutation", async () => {
  const { directory, store } = await temporaryStore();
  try {
    const gateway = new FakeGateway();
    const controller = new RunpodController({
      store,
      gateway,
      catalog: { overview: async () => overview(0.8) },
      config: { ...config, hardCostLimitUsd: 0.2 },
    });

    await assert.rejects(
      controller.start({
        operationId: "operation_budget_0001",
        profileId: "3090",
        durationMinutes: 60,
        maximumHourlyRate: 1,
      }),
      /hard cost limit/,
    );
    assert.equal(gateway.createCalls, 0);
    assert.equal((await store.read()).operations.length, 0);
  } finally {
    await removeTemporary(directory);
  }
});

test("watchdog retries a failed stop and closes only after verified EXITED", async () => {
  const { directory, store } = await temporaryStore();
  try {
    let clock = new Date("2026-09-21T01:00:00.000Z");
    const gateway = new FakeGateway();
    const controller = new RunpodController({
      store,
      gateway,
      catalog: { overview: async () => overview() },
      config,
      now: () => clock,
      workload: idleWorkload(),
    });
    await controller.start({
      operationId: "operation_watchdog_01",
      profileId: "3090",
      durationMinutes: 30,
      maximumHourlyRate: 0.6,
    });
    gateway.pods[0].status = "RUNNING";
    gateway.stopFailures = 1;
    clock = new Date("2026-09-21T01:30:01.000Z");

    await assert.rejects(controller.runWatchdog(), /simulated stop failure/);
    const failed = await store.read();
    assert.equal(failed.session.phase, "error");
    assert.equal(failed.session.retryCount, 1);
    assert.equal(failed.session.stopConfirmedAt, null);
    assert.equal(failed.session.nextRetryAt, "2026-09-21T01:30:31.000Z");

    const waiting = await controller.runWatchdog();
    assert.equal(waiting.session.retryCount, 1);
    assert.equal(gateway.stopCalls, 1);

    clock = new Date("2026-09-21T01:30:32.000Z");
    const stopped = await controller.runWatchdog();
    assert.equal(gateway.stopCalls, 2);
    assert.equal(stopped.session.phase, "stopped");
    assert.equal(stopped.session.stopConfirmedAt, "2026-09-21T01:30:32.000Z");
    assert.equal(stopped.session.retryCount, 0);
  } finally {
    await removeTemporary(directory);
  }
});

test("watchdog backs off when stop is accepted but not yet verified", async () => {
  const { directory, store } = await temporaryStore();
  try {
    let clock = new Date("2026-09-21T01:00:00.000Z");
    const gateway = new FakeGateway();
    gateway.stopResultStatus = "RUNNING";
    const controller = new RunpodController({
      store,
      gateway,
      catalog: { overview: async () => overview() },
      config,
      now: () => clock,
      workload: idleWorkload(),
    });
    await controller.start({
      operationId: "operation_unverified_1",
      profileId: "3090",
      durationMinutes: 30,
      maximumHourlyRate: 0.6,
    });
    gateway.pods[0].status = "RUNNING";
    clock = new Date("2026-09-21T01:30:01.000Z");

    const pending = await controller.runWatchdog();
    assert.equal(pending.session.phase, "stopping");
    assert.equal(pending.session.stopConfirmedAt, null);
    assert.equal(pending.session.retryCount, 1);
    await controller.runWatchdog();
    assert.equal(gateway.stopCalls, 1);

    gateway.stopResultStatus = "EXITED";
    clock = new Date("2026-09-21T01:30:32.000Z");
    const confirmed = await controller.runWatchdog();
    assert.equal(gateway.stopCalls, 2);
    assert.equal(confirmed.session.phase, "stopped");
    assert.equal(confirmed.session.stopConfirmedAt, clock.toISOString());
  } finally {
    await removeTemporary(directory);
  }
});

test("idle watchdog waits for running and queued jobs before stopping", async () => {
  const { directory, store } = await temporaryStore();
  try {
    let clock = new Date("2026-09-21T01:00:00.000Z");
    let workload: RunpodWorkloadSnapshot = {
      runningJobCount: 1,
      queuedJobCount: 0,
      lastActivityAt: clock.toISOString(),
      idleMinutes: 5,
    };
    const gateway = new FakeGateway();
    const controller = new RunpodController({
      store,
      gateway,
      catalog: { overview: async () => overview() },
      config,
      now: () => clock,
      workerProbe: async () => true,
      workload: { snapshot: async () => structuredClone(workload) },
    });
    await controller.start({
      operationId: "operation_idle_start_01",
      profileId: "3090",
      durationMinutes: 30,
      maximumHourlyRate: 0.6,
    });
    gateway.pods[0].status = "RUNNING";
    await controller.reconcile();

    clock = new Date("2026-09-21T01:06:00.000Z");
    const running = await controller.runWatchdog();
    assert.equal(running.session.runningJobCount, 1);
    assert.equal(running.session.idleDeadline, null);
    assert.equal(gateway.stopCalls, 0);

    workload = {
      runningJobCount: 0,
      queuedJobCount: 1,
      lastActivityAt: "2026-09-21T01:06:00.000Z",
      idleMinutes: 5,
    };
    clock = new Date("2026-09-21T01:08:00.000Z");
    const queued = await controller.runWatchdog();
    assert.equal(queued.session.queuedJobCount, 1);
    assert.equal(queued.session.idleDeadline, null);
    assert.equal(gateway.stopCalls, 0);

    workload = {
      runningJobCount: 0,
      queuedJobCount: 0,
      lastActivityAt: "2026-09-21T01:08:00.000Z",
      idleMinutes: 5,
    };
    const idle = await controller.syncWorkload();
    assert.equal(idle.session.idleDeadline, "2026-09-21T01:13:00.000Z");
    clock = new Date("2026-09-21T01:12:59.000Z");
    await controller.runWatchdog();
    assert.equal(gateway.stopCalls, 0);

    clock = new Date("2026-09-21T01:13:01.000Z");
    const stopped = await controller.runWatchdog();
    assert.equal(gateway.stopCalls, 1);
    assert.equal(stopped.session.phase, "stopped");
    assert.equal(stopped.session.stopReason, "idle_deadline");
  } finally {
    await removeTemporary(directory);
  }
});

test("hard deadline stops a session even while a job is running", async () => {
  const { directory, store } = await temporaryStore();
  try {
    let clock = new Date("2026-09-21T01:00:00.000Z");
    const gateway = new FakeGateway();
    const controller = new RunpodController({
      store,
      gateway,
      catalog: { overview: async () => overview() },
      config,
      now: () => clock,
      workload: idleWorkload({
        runningJobCount: 1,
        lastActivityAt: clock.toISOString(),
        idleMinutes: 5,
      }),
    });
    await controller.start({
      operationId: "operation_hard_busy_01",
      profileId: "3090",
      durationMinutes: 30,
      maximumHourlyRate: 0.6,
    });
    gateway.pods[0].status = "RUNNING";
    await controller.syncWorkload();
    clock = new Date("2026-09-21T01:30:01.000Z");

    const stopped = await controller.runWatchdog();
    assert.equal(gateway.stopCalls, 1);
    assert.equal(stopped.session.phase, "stopped");
    assert.equal(stopped.session.runningJobCount, 1);
    assert.equal(stopped.session.stopReason, "hard_deadline");
  } finally {
    await removeTemporary(directory);
  }
});

test("hard deadline does not depend on the workload snapshot", async () => {
  const { directory, store } = await temporaryStore();
  try {
    let clock = new Date("2026-09-21T01:00:00.000Z");
    const gateway = new FakeGateway();
    const controller = new RunpodController({
      store,
      gateway,
      catalog: { overview: async () => overview() },
      config,
      now: () => clock,
      workload: {
        snapshot: async () => {
          throw new Error("workload unavailable");
        },
      },
    });
    await controller.start({
      operationId: "operation_hard_unavailable_01",
      profileId: "3090",
      durationMinutes: 30,
      maximumHourlyRate: 0.6,
    });
    gateway.pods[0].status = "RUNNING";
    clock = new Date("2026-09-21T01:30:01.000Z");

    const stopped = await controller.runWatchdog();
    assert.equal(gateway.stopCalls, 1);
    assert.equal(stopped.session.phase, "stopped");
    assert.equal(stopped.session.stopReason, "hard_deadline");
  } finally {
    await removeTemporary(directory);
  }
});

test("deadline extension is atomic, idempotent, and bounded by hard cost", async () => {
  const { directory, store } = await temporaryStore();
  try {
    const gateway = new FakeGateway();
    const controller = new RunpodController({
      store,
      gateway,
      catalog: { overview: async () => overview() },
      config,
      now: () => new Date("2026-09-21T01:00:00.000Z"),
      workerProbe: async () => true,
    });
    await controller.start({
      operationId: "operation_extend_start",
      profileId: "3090",
      durationMinutes: 60,
      maximumHourlyRate: 0.6,
    });
    gateway.pods[0].status = "RUNNING";
    await controller.reconcile();

    const firstInput = {
      operationId: "operation_extend_0001",
      additionalMinutes: 30,
    };
    const first = await controller.extend(firstInput);
    assert.equal(first.session.hardDeadline, "2026-09-21T02:30:00.000Z");
    const repeated = await controller.extend(firstInput);
    assert.equal(repeated.session.hardDeadline, first.session.hardDeadline);
    assert.equal(
      repeated.operations.filter((operation) => operation.kind === "extend")
        .length,
      1,
    );
    assert.equal(
      repeated.operations.find((operation) => operation.kind === "extend")
        ?.mutationAttemptedAt,
      null,
    );

    const second = await controller.extend({
      operationId: "operation_extend_0002",
      additionalMinutes: 30,
    });
    assert.equal(second.session.hardDeadline, "2026-09-21T03:00:00.000Z");
    await assert.rejects(
      controller.extend({
        operationId: "operation_extend_0003",
        additionalMinutes: 30,
      }),
      /hard cost limit/,
    );
    assert.equal(
      (await store.read()).session.hardDeadline,
      "2026-09-21T03:00:00.000Z",
    );
  } finally {
    await removeTemporary(directory);
  }
});

test("disabled controller status remains reviewable and watchdog performs no calls", async () => {
  const { directory, store } = await temporaryStore();
  try {
    const gateway = new FakeGateway();
    const controller = new RunpodController({
      store,
      gateway,
      catalog: { overview: async () => overview() },
      config: {
        ...config,
        writeEnabled: false,
        dataCenterId: "",
        networkVolumeId: "",
      },
    });

    const status = await controller.status();
    const summary = await runRunpodWatchdogOnce(
      controller,
      () => new Date("2026-09-21T02:00:00.000Z"),
    );
    assert.equal(status.writeEnabled, false);
    assert.equal(status.storage.strategy, "network-volume");
    assert.equal(status.storage.estimatedMonthlyUsd, 2.1);
    assert.equal(status.safeguards.terminateImplemented, false);
    assert.equal(status.safeguards.cloudWatchdogDeployed, false);
    assert.ok(status.blockers.some((item) => item.includes("WRITE_ENABLED")));
    assert.equal(summary.action, "skipped_writes_disabled");
    assert.equal(summary.phase, "off");
    assert.equal(summary.ranAt, "2026-09-21T02:00:00.000Z");
    assert.equal(gateway.stopCalls, 0);
  } finally {
    await removeTemporary(directory);
  }
});

test("independent control stores serialize transactions with a file lock", async () => {
  const { directory } = await temporaryStore();
  try {
    const stores = Array.from(
      { length: 12 },
      () => new RunpodControlStore(directory),
    );
    await Promise.all(
      stores.map((store, index) =>
        store.mutate(async (state) => {
          await new Promise((resolveWait) => setTimeout(resolveWait, 2));
          state.session.message += `|writer-${index}`;
        }),
      ),
    );

    const state = await new RunpodControlStore(directory).read();
    assert.equal(state.revision, 12);
    for (let index = 0; index < stores.length; index += 1)
      assert.match(state.session.message, new RegExp(`\\|writer-${index}`));
    assert.deepEqual(await readdir(directory), ["runpod-control.json"]);
  } finally {
    await removeTemporary(directory);
  }
});

test("control store recovers a stale lock left by a dead process", async () => {
  const { directory, store } = await temporaryStore();
  try {
    await store.read();
    const lockFile = join(directory, "runpod-control.lock");
    await writeFile(lockFile, '{"owner":"dead-process"}\n', "utf8");
    const stale = new Date(Date.now() - 120_000);
    await utimes(lockFile, stale, stale);

    const recovered = new RunpodControlStore(directory);
    await recovered.mutate((state) => {
      state.session.message = "Recovered after stale file lock.";
    });
    assert.equal((await recovered.read()).revision, 1);
    await assert.rejects(readFile(lockFile, "utf8"), /ENOENT/);
  } finally {
    await removeTemporary(directory);
  }
});
