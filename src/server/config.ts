import { resolve } from "node:path";

const projectRoot = process.cwd();

function environmentFlag(name: string): boolean {
  return process.env[name]?.trim().toLowerCase() === "true";
}

export const serverConfig = {
  dataDir: resolve(
    /* turbopackIgnore: true */ projectRoot,
    process.env.VOXCPM_DATA_DIR || ".data",
  ),
  workerUrl: (process.env.WORKER_URL || "").replace(/\/$/, ""),
  workerApiKey: process.env.WORKER_API_KEY || "",
  studioApiKey: process.env.STUDIO_API_KEY || "",
  studioAccessPassword: process.env.STUDIO_ACCESS_PASSWORD || "",
  studioSessionSecret: process.env.STUDIO_SESSION_SECRET || "",
  runpodApiKey: process.env.RUNPOD_API_KEY || "",
  runpodApiBaseUrl: (
    process.env.RUNPOD_API_BASE_URL || "https://api.runpod.io/v2"
  ).replace(/\/$/, ""),
  runpodWorkerImage:
    process.env.RUNPOD_WORKER_IMAGE ||
    "ghcr.io/muhira007/voxcpm-studio-worker@sha256:763938c78e0d1be4ccb968ab6dd7a351b6a14be5b7f8001e7c04540df7df6071",
  runpodWriteEnabled: environmentFlag("RUNPOD_WRITE_ENABLED"),
  runpodCloud: process.env.RUNPOD_CLOUD || "SECURE",
  runpodDataCenterId: process.env.RUNPOD_DATA_CENTER_ID || "",
  runpodNetworkVolumeId: process.env.RUNPOD_NETWORK_VOLUME_ID || "",
  runpodHardCostLimitUsd: Number(process.env.RUNPOD_HARD_COST_LIMIT_USD || "1"),
  runpodMaxSessionMinutes: Number(
    process.env.RUNPOD_MAX_SESSION_MINUTES || "240",
  ),
  runpodWriteScopeConfirmed: environmentFlag("RUNPOD_WRITE_SCOPE_CONFIRMED"),
  runpodBalanceConfirmed: environmentFlag("RUNPOD_BALANCE_CONFIRMED"),
  runpodSingleReplicaConfirmed: environmentFlag(
    "RUNPOD_SINGLE_REPLICA_CONFIRMED",
  ),
  runpodPersistentStateConfirmed: environmentFlag(
    "RUNPOD_PERSISTENT_STATE_CONFIRMED",
  ),
  runpodWatchdogDeployed: environmentFlag("RUNPOD_WATCHDOG_DEPLOYED"),
  runpodStopAlertConfigured: environmentFlag("RUNPOD_STOP_ALERT_CONFIGURED"),
  runpodPreflightProfileId: process.env.RUNPOD_PREFLIGHT_PROFILE_ID || "3090",
  runpodPreflightDurationMinutes: Number(
    process.env.RUNPOD_PREFLIGHT_DURATION_MINUTES || "30",
  ),
  runpodPreflightMaxHourlyRate: Number(
    process.env.RUNPOD_PREFLIGHT_MAX_HOURLY_RATE || "0.80",
  ),
};

export function validateServerConfiguration(): string[] {
  const errors: string[] = [];
  if (serverConfig.studioApiKey.length < 32)
    errors.push("STUDIO_API_KEY must contain at least 32 characters.");
  if (serverConfig.workerApiKey.length < 32)
    errors.push("WORKER_API_KEY must contain at least 32 characters.");
  if (!/^https?:\/\//.test(serverConfig.workerUrl))
    errors.push("WORKER_URL must be an HTTP(S) URL.");
  return errors;
}

export function validateWebAuthConfiguration(): string[] {
  const errors: string[] = [];
  if (serverConfig.studioAccessPassword.length < 12)
    errors.push("STUDIO_ACCESS_PASSWORD must contain at least 12 characters.");
  if (serverConfig.studioSessionSecret.length < 32)
    errors.push("STUDIO_SESSION_SECRET must contain at least 32 characters.");
  return errors;
}

export function validateRunpodReadConfiguration(): string[] {
  const errors: string[] = [];
  if (serverConfig.runpodApiKey.length < 32)
    errors.push("RUNPOD_API_KEY must contain at least 32 characters.");
  try {
    const baseUrl = new URL(serverConfig.runpodApiBaseUrl);
    if (
      baseUrl.protocol !== "https:" ||
      baseUrl.username ||
      baseUrl.password ||
      baseUrl.search ||
      baseUrl.hash
    )
      errors.push("RUNPOD_API_BASE_URL must be a plain HTTPS URL.");
  } catch {
    errors.push("RUNPOD_API_BASE_URL must be a valid URL.");
  }
  if (!/@sha256:[a-f0-9]{64}$/.test(serverConfig.runpodWorkerImage))
    errors.push("RUNPOD_WORKER_IMAGE must use an immutable sha256 digest.");
  return errors;
}

export function validateRunpodWriteConfiguration(): string[] {
  const errors = validateRunpodReadConfiguration();
  if (!serverConfig.runpodWriteEnabled)
    errors.push("RUNPOD_WRITE_ENABLED is false.");
  if (!["SECURE", "COMMUNITY"].includes(serverConfig.runpodCloud.toUpperCase()))
    errors.push("RUNPOD_CLOUD must be SECURE or COMMUNITY.");
  if (!/^[A-Za-z0-9-]{2,50}$/.test(serverConfig.runpodDataCenterId))
    errors.push("RUNPOD_DATA_CENTER_ID is not configured.");
  if (!/^[A-Za-z0-9_-]{3,100}$/.test(serverConfig.runpodNetworkVolumeId))
    errors.push("RUNPOD_NETWORK_VOLUME_ID is not configured.");
  if (
    !Number.isFinite(serverConfig.runpodHardCostLimitUsd) ||
    serverConfig.runpodHardCostLimitUsd <= 0 ||
    serverConfig.runpodHardCostLimitUsd > 25
  )
    errors.push("RUNPOD_HARD_COST_LIMIT_USD must be between 0 and 25.");
  if (![30, 60, 120, 240].includes(serverConfig.runpodMaxSessionMinutes))
    errors.push("RUNPOD_MAX_SESSION_MINUTES must be 30, 60, 120, or 240.");
  if (!serverConfig.runpodWriteScopeConfirmed)
    errors.push("RUNPOD_WRITE_SCOPE_CONFIRMED is false.");
  if (!serverConfig.runpodBalanceConfirmed)
    errors.push("RUNPOD_BALANCE_CONFIRMED is false.");
  if (!serverConfig.runpodSingleReplicaConfirmed)
    errors.push("RUNPOD_SINGLE_REPLICA_CONFIRMED is false.");
  if (!serverConfig.runpodPersistentStateConfirmed)
    errors.push("RUNPOD_PERSISTENT_STATE_CONFIRMED is false.");
  if (!serverConfig.runpodWatchdogDeployed)
    errors.push("RUNPOD_WATCHDOG_DEPLOYED is false.");
  if (!serverConfig.runpodStopAlertConfigured)
    errors.push("RUNPOD_STOP_ALERT_CONFIGURED is false.");
  return errors;
}
