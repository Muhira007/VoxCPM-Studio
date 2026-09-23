import assert from "node:assert/strict";
import { test } from "node:test";
import type { RunpodOverview } from "../src/lib/runpod-types.ts";
import {
  runRunpodPreflight,
  type RunpodPreflightConfig,
} from "../src/server/runpod-preflight.ts";

const image =
  "ghcr.io/muhira007/voxcpm-studio-worker@sha256:90ba964343f769a428259a59ac0acd8523de82c02f4ffddd82e2e8d78d715fbd";

function overview(): RunpodOverview {
  return {
    mode: "read-only",
    observedAt: "2026-09-23T08:00:00.000Z",
    source: "RunPod REST API v2",
    minimumCudaVersion: "12.8",
    writesEnabled: false,
    mutationAttempted: false,
    inventory: { podCount: 0, pods: [] },
    catalog: {
      gpuTypeCount: 1,
      dataCenterCount: 1,
      dataCenters: [
        {
          id: "EU-CZ-1",
          name: "EU-CZ-1",
          region: "EU",
          networkVolumeTypes: ["NETWORK_VOLUME"],
        },
      ],
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
              dataCenters: ["EU-CZ-1"],
            },
            secure: {
              hourlyRate: 0.5,
              availability: "MEDIUM",
              dataCenters: ["EU-CZ-1"],
            },
          },
        },
      ],
    },
  };
}

function readyConfig(
  overrides: Partial<RunpodPreflightConfig> = {},
): RunpodPreflightConfig {
  return {
    apiKey: "runpod_preflight_key_for_tests_123456789",
    apiBaseUrl: "https://api.runpod.test/v2",
    workerImage: image,
    writeEnabled: true,
    writeScopeConfirmed: true,
    balanceConfirmed: true,
    cloud: "SECURE",
    dataCenterId: "EU-CZ-1",
    networkVolumeId: "volume_test_001",
    hardCostLimitUsd: 1,
    maximumSessionMinutes: 240,
    profileId: "3090",
    durationMinutes: 30,
    maximumHourlyRate: 0.6,
    dataDirectory: "D:/persistent/voxcpm",
    singleReplicaConfirmed: true,
    persistentStateConfirmed: true,
    watchdogDeployed: true,
    stopAlertConfigured: true,
    ...overrides,
  };
}

test("RunPod preflight reports a fully ready first-cycle plan", async () => {
  let inspectedPath = "";
  const report = await runRunpodPreflight({
    config: readyConfig(),
    loadOverview: async () => overview(),
    dataDirectoryAccessible: async (path) => {
      inspectedPath = path;
      return true;
    },
    now: () => new Date("2026-09-23T08:01:00.000Z"),
  });

  assert.equal(report.ok, true);
  assert.equal(report.readyForPaidCycle, true);
  assert.equal(report.safeDryRun, true);
  assert.equal(report.mutationAttempted, false);
  assert.equal(report.observedAt, "2026-09-23T08:01:00.000Z");
  assert.equal(report.overviewObservedAt, "2026-09-23T08:00:00.000Z");
  assert.equal(report.plan.hourlyRate, 0.5);
  assert.equal(report.plan.estimatedComputeCostUsd, 0.25);
  assert.equal(report.failedCheckIds.length, 0);
  assert.equal(
    report.checks.every((item) => item.passed),
    true,
  );
  assert.equal(inspectedPath, "D:/persistent/voxcpm");
});

test("RunPod preflight lists paid-operation blockers without exposing secrets", async () => {
  const apiKey = "runpod_preflight_secret_123456789012345";
  const report = await runRunpodPreflight({
    config: readyConfig({
      apiKey,
      writeEnabled: false,
      writeScopeConfirmed: false,
      balanceConfirmed: false,
      dataCenterId: "",
      networkVolumeId: "",
      singleReplicaConfirmed: false,
      persistentStateConfirmed: false,
      watchdogDeployed: false,
      stopAlertConfigured: false,
    }),
    loadOverview: async () => overview(),
    dataDirectoryAccessible: async () => true,
  });

  assert.equal(report.readyForPaidCycle, false);
  assert.equal(report.safeDryRun, true);
  assert.equal(report.mutationAttempted, false);
  for (const id of [
    "write_gateway_enabled",
    "write_scope_confirmed",
    "account_balance_confirmed",
    "network_volume_configured",
    "data_center_compatible",
    "single_replica_confirmed",
    "persistent_state_confirmed",
    "watchdog_deployed",
    "stop_alert_configured",
  ])
    assert.ok(report.failedCheckIds.includes(id));
  assert.equal(JSON.stringify(report).includes(apiKey), false);
  assert.equal(JSON.stringify(report).includes(image), false);
});

test("RunPod preflight converts an unavailable read-only probe into a blocker", async () => {
  const report = await runRunpodPreflight({
    config: readyConfig(),
    loadOverview: async () => {
      throw new Error("upstream details must not escape");
    },
    dataDirectoryAccessible: async () => true,
  });

  assert.equal(report.readyForPaidCycle, false);
  assert.ok(report.failedCheckIds.includes("read_only_probe"));
  assert.ok(report.failedCheckIds.includes("gpu_offer_available"));
  assert.equal(
    JSON.stringify(report).includes("upstream details must not escape"),
    false,
  );
});
