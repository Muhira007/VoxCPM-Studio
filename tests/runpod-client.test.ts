import assert from "node:assert/strict";
import { test } from "node:test";
import { RunpodClient } from "../src/server/runpod-client.ts";

const apiKey = "runpod_read_only_key_for_tests_123456789";
const image =
  "ghcr.io/muhira007/voxcpm-studio-worker@sha256:763938c78e0d1be4ccb968ab6dd7a351b6a14be5b7f8001e7c04540df7df6071";

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function gpu(
  id: string,
  availability: string,
  community: number,
  secure: number,
) {
  return {
    id,
    memory: 24,
    availability,
    price: { community, secure },
    dataCenters:
      availability === "NONE"
        ? []
        : [{ id: "EU-CZ-1", name: "EU-CZ-1", availability }],
    cudaVersions: [
      { version: "12.8", available: true },
      { version: "13.0", available: true },
    ],
  };
}

test("RunPod overview uses authenticated GET requests and normalizes inventory and both catalogs", async () => {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    if (url.pathname.endsWith("/pods"))
      return json({
        pods: [],
        pagination: { hasNextPage: false, nextCursor: null },
      });
    if (url.pathname.endsWith("/catalog/datacenters"))
      return json({
        dataCenters: [
          {
            id: "EU-CZ-1",
            name: "EU-CZ-1",
            region: "EUROPE",
            networkVolumeTypes: [{ id: "NETWORK_VOLUME" }],
          },
        ],
      });
    if (url.pathname.endsWith("/catalog/gpus")) {
      const cloud = url.searchParams.get("cloud");
      assert.ok(cloud === "COMMUNITY" || cloud === "SECURE");
      assert.equal(url.searchParams.get("minCudaVersion"), "12.8");
      return json({
        gpus: [
          gpu("NVIDIA RTX A5000", "NONE", 0.16, 0.27),
          gpu("NVIDIA GeForce RTX 3090", "LOW", 0.22, 0.5),
          gpu("NVIDIA GeForce RTX 4090", "MEDIUM", 0.34, 0.74),
        ],
      });
    }
    throw new Error(`Unexpected RunPod path: ${url.pathname}`);
  };
  const client = new RunpodClient({
    apiKey,
    baseUrl: "https://api.runpod.test/v2",
    workerImage: image,
    fetcher,
  });

  const [overview, concurrentOverview] = await Promise.all([
    client.overview(),
    client.overview(),
  ]);

  assert.equal(overview.mode, "read-only");
  assert.equal(overview.writesEnabled, false);
  assert.equal(overview.mutationAttempted, false);
  assert.equal(overview.inventory.podCount, 0);
  assert.equal(overview.catalog.gpuTypeCount, 3);
  assert.equal(overview.catalog.dataCenterCount, 1);
  assert.equal(overview.catalog.profiles[1].offers.community.hourlyRate, 0.22);
  assert.equal(overview.catalog.profiles[1].offers.secure.hourlyRate, 0.5);
  assert.deepEqual(overview.catalog.profiles[1].cudaVersions, ["12.8", "13.0"]);
  assert.equal(concurrentOverview.observedAt, overview.observedAt);
  assert.equal(calls.length, 4);
  for (const call of calls) {
    assert.equal(call.init?.method, "GET");
    assert.equal(
      new Headers(call.init?.headers).get("authorization"),
      `Bearer ${apiKey}`,
    );
    assert.equal(call.url.toString().includes(apiKey), false);
  }
});

test("RunPod Pod inventory follows cursors without repeating a page", async () => {
  const visited: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    visited.push(url.searchParams.get("cursor") || "first");
    if (!url.searchParams.has("cursor"))
      return json({
        pods: [{ id: "pod-1", name: "First", status: "RUNNING" }],
        pagination: { hasNextPage: true, nextCursor: "cursor-2" },
      });
    return json({
      pods: [{ id: "pod-2", name: "Second", desiredStatus: "EXITED" }],
      pagination: { hasNextPage: false, nextCursor: null },
    });
  };
  const client = new RunpodClient({
    apiKey,
    baseUrl: "https://api.runpod.test/v2",
    workerImage: image,
    fetcher,
  });

  const pods = await client.listPods();

  assert.deepEqual(visited, ["first", "cursor-2"]);
  assert.deepEqual(
    pods.map((pod) => [pod.id, pod.status]),
    [
      ["pod-1", "RUNNING"],
      ["pod-2", "EXITED"],
    ],
  );
});

test("RunPod dry-run enforces price, availability, inventory, storage, and read-only blockers", async () => {
  const client = new RunpodClient({ apiKey, workerImage: image });
  const plan = client.plan(
    {
      mode: "read-only",
      observedAt: "2026-09-21T00:00:00.000Z",
      source: "RunPod REST API v2",
      minimumCudaVersion: "12.8",
      writesEnabled: false,
      mutationAttempted: false,
      inventory: {
        podCount: 1,
        pods: [
          {
            id: "existing-pod",
            name: "Existing",
            status: "RUNNING",
            gpuTypeId: null,
            image: null,
            hourlyRate: null,
          },
        ],
      },
      catalog: {
        gpuTypeCount: 1,
        dataCenterCount: 0,
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
                availability: "NONE",
                dataCenters: [],
              },
              secure: {
                hourlyRate: 0.5,
                availability: "LOW",
                dataCenters: ["EU-CZ-1"],
              },
            },
          },
        ],
      },
    },
    {
      profileId: "3090",
      cloud: "community",
      durationMinutes: 60,
      maximumHourlyRate: 0.2,
    },
  );

  assert.equal(plan.dryRun, true);
  assert.equal(plan.resourceCreated, false);
  assert.equal(plan.mutationAttempted, false);
  assert.equal(plan.readyForPaidCreate, false);
  assert.equal(plan.estimatedComputeCost, 0.22);
  assert.equal(plan.checks.immutableImage, true);
  assert.equal(plan.checks.noExistingPods, false);
  assert.equal(plan.checks.rateWithinLimit, false);
  assert.equal(plan.checks.gpuAvailable, false);
  assert.equal(plan.checks.storageSelected, true);
  assert.equal(plan.checks.writeOperationsDisabled, true);
  assert.ok(plan.blockers.some((item) => item.includes("operasi baca")));
  assert.ok(plan.blockers.some((item) => item.includes("Network Volume")));
});

test("RunPod upstream errors do not expose response bodies or credentials", async () => {
  const client = new RunpodClient({
    apiKey,
    baseUrl: "https://api.runpod.test/v2",
    workerImage: image,
    fetcher: async () =>
      new Response(`invalid key: ${apiKey}`, { status: 401 }),
  });

  await assert.rejects(client.listPods(), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /rejected/);
    assert.equal(error.message.includes(apiKey), false);
    return true;
  });
});
