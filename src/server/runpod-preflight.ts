import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import type {
  RunpodCloud,
  RunpodOverview,
  RunpodProfileId,
} from "../lib/runpod-types.ts";
import { serverConfig } from "./config.ts";
import { runpodClient } from "./runpod-client.ts";

const ALLOWED_PROFILES = new Set<RunpodProfileId>(["a5000", "3090", "4090"]);
const ALLOWED_DURATIONS = new Set([30, 60, 120, 240]);

export interface RunpodPreflightConfig {
  apiKey: string;
  apiBaseUrl: string;
  workerImage: string;
  writeEnabled: boolean;
  writeScopeConfirmed: boolean;
  balanceConfirmed: boolean;
  cloud: string;
  dataCenterId: string;
  networkVolumeId: string;
  hardCostLimitUsd: number;
  maximumSessionMinutes: number;
  profileId: string;
  durationMinutes: number;
  maximumHourlyRate: number;
  dataDirectory: string;
  singleReplicaConfirmed: boolean;
  persistentStateConfirmed: boolean;
  watchdogDeployed: boolean;
  stopAlertConfigured: boolean;
}

export interface RunpodPreflightCheck {
  id: string;
  passed: boolean;
  message: string;
}

export interface RunpodPreflightReport {
  ok: true;
  observedAt: string;
  readyForPaidCycle: boolean;
  safeDryRun: boolean;
  mutationAttempted: false;
  overviewObservedAt: string | null;
  plan: {
    profileId: string;
    cloud: string;
    durationMinutes: number;
    maximumHourlyRate: number;
    hourlyRate: number | null;
    estimatedComputeCostUsd: number | null;
    hardCostLimitUsd: number;
    availability: string | null;
    dataCenterConfigured: boolean;
    networkVolumeConfigured: boolean;
  };
  checks: RunpodPreflightCheck[];
  failedCheckIds: string[];
  blockers: string[];
}

interface RunpodPreflightDependencies {
  config?: RunpodPreflightConfig;
  loadOverview?: () => Promise<RunpodOverview>;
  dataDirectoryAccessible?: (path: string) => Promise<boolean>;
  now?: () => Date;
}

function defaultConfig(): RunpodPreflightConfig {
  return {
    apiKey: serverConfig.runpodApiKey,
    apiBaseUrl: serverConfig.runpodApiBaseUrl,
    workerImage: serverConfig.runpodWorkerImage,
    writeEnabled: serverConfig.runpodWriteEnabled,
    writeScopeConfirmed: serverConfig.runpodWriteScopeConfirmed,
    balanceConfirmed: serverConfig.runpodBalanceConfirmed,
    cloud: serverConfig.runpodCloud,
    dataCenterId: serverConfig.runpodDataCenterId,
    networkVolumeId: serverConfig.runpodNetworkVolumeId,
    hardCostLimitUsd: serverConfig.runpodHardCostLimitUsd,
    maximumSessionMinutes: serverConfig.runpodMaxSessionMinutes,
    profileId: serverConfig.runpodPreflightProfileId,
    durationMinutes: serverConfig.runpodPreflightDurationMinutes,
    maximumHourlyRate: serverConfig.runpodPreflightMaxHourlyRate,
    dataDirectory: serverConfig.dataDir,
    singleReplicaConfirmed: serverConfig.runpodSingleReplicaConfirmed,
    persistentStateConfirmed: serverConfig.runpodPersistentStateConfirmed,
    watchdogDeployed: serverConfig.runpodWatchdogDeployed,
    stopAlertConfigured: serverConfig.runpodStopAlertConfigured,
  };
}

function validApiBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return Boolean(
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash,
    );
  } catch {
    return false;
  }
}

async function defaultDataDirectoryAccessible(path: string): Promise<boolean> {
  try {
    const metadata = await stat(path);
    if (!metadata.isDirectory()) return false;
    await access(path, constants.R_OK | constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function roundUsd(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

export async function runRunpodPreflight(
  dependencies: RunpodPreflightDependencies = {},
): Promise<RunpodPreflightReport> {
  const config = dependencies.config ?? defaultConfig();
  const loadOverview =
    dependencies.loadOverview ?? (() => runpodClient.overview({ fresh: true }));
  const inspectDataDirectory =
    dependencies.dataDirectoryAccessible ?? defaultDataDirectoryAccessible;
  const now = dependencies.now ?? (() => new Date());
  const readConfigurationValid =
    config.apiKey.length >= 32 && validApiBaseUrl(config.apiBaseUrl);
  let overview: RunpodOverview | null = null;
  if (readConfigurationValid) {
    try {
      overview = await loadOverview();
    } catch {
      overview = null;
    }
  }
  const dataDirectoryAccessible = await inspectDataDirectory(
    config.dataDirectory,
  );
  const cloud = config.cloud.toLowerCase();
  const validCloud = cloud === "community" || cloud === "secure";
  const validProfile = ALLOWED_PROFILES.has(
    config.profileId as RunpodProfileId,
  );
  const profile = validProfile
    ? (overview?.catalog.profiles.find(
        (item) => item.profileId === config.profileId,
      ) ?? null)
    : null;
  const offer =
    profile && validCloud ? profile.offers[cloud as RunpodCloud] : null;
  const hourlyRate = offer?.hourlyRate ?? null;
  const estimatedComputeCostUsd =
    hourlyRate === null || !Number.isFinite(config.durationMinutes)
      ? null
      : roundUsd((hourlyRate * config.durationMinutes) / 60);
  const dataCenter = overview?.catalog.dataCenters.find(
    (item) => item.id === config.dataCenterId,
  );
  const dataCenterSupportsNetworkVolume = Boolean(
    dataCenter?.networkVolumeTypes.some((item) =>
      item.toUpperCase().includes("NETWORK"),
    ),
  );
  const dataCenterCompatible = Boolean(
    offer?.dataCenters.includes(config.dataCenterId) &&
    dataCenterSupportsNetworkVolume,
  );
  const checks: RunpodPreflightCheck[] = [];
  const check = (
    id: string,
    passed: boolean,
    passedMessage: string,
    failedMessage: string,
  ) =>
    checks.push({
      id,
      passed,
      message: passed ? passedMessage : failedMessage,
    });

  check(
    "read_configuration",
    readConfigurationValid,
    "Konfigurasi REST API baca saja valid.",
    "RUNPOD_API_KEY dan RUNPOD_API_BASE_URL belum valid.",
  );
  check(
    "read_only_probe",
    Boolean(
      overview &&
      overview.mode === "read-only" &&
      !overview.writesEnabled &&
      !overview.mutationAttempted,
    ),
    "Inventaris dan katalog berhasil dibaca tanpa mutation.",
    "Probe inventaris/katalog baca saja belum berhasil.",
  );
  check(
    "no_existing_pods",
    overview?.inventory.podCount === 0,
    "Inventaris tidak berisi Pod yang harus direkonsiliasi.",
    "Inventaris belum terbaca atau masih berisi Pod yang harus direkonsiliasi.",
  );
  check(
    "immutable_worker_image",
    /@sha256:[a-f0-9]{64}$/.test(config.workerImage),
    "Image worker memakai digest sha256 immutable.",
    "RUNPOD_WORKER_IMAGE belum memakai digest sha256 immutable.",
  );
  check(
    "write_gateway_enabled",
    config.writeEnabled,
    "Gateway operasi tulis diaktifkan untuk siklus terkontrol.",
    "RUNPOD_WRITE_ENABLED masih false.",
  );
  check(
    "write_scope_confirmed",
    config.writeScopeConfirmed,
    "Scope key create/start/stop telah dikonfirmasi operator.",
    "Scope key tulis belum dikonfirmasi melalui RUNPOD_WRITE_SCOPE_CONFIRMED.",
  );
  check(
    "account_balance_confirmed",
    config.balanceConfirmed,
    "Saldo untuk siklus pertama telah dikonfirmasi operator.",
    "Saldo belum dikonfirmasi melalui RUNPOD_BALANCE_CONFIRMED.",
  );
  check(
    "network_volume_configured",
    /^[A-Za-z0-9_-]{3,100}$/.test(config.networkVolumeId),
    "Network Volume aktual telah dikonfigurasi.",
    "RUNPOD_NETWORK_VOLUME_ID belum dikonfigurasi.",
  );
  check(
    "data_center_compatible",
    dataCenterCompatible,
    "Data center mendukung profil GPU dan Network Volume terpilih.",
    "Data center belum dikonfigurasi atau tidak cocok dengan GPU/Network Volume.",
  );
  check(
    "gpu_offer_available",
    Boolean(
      offer &&
      offer.availability !== "NONE" &&
      offer.availability !== "UNKNOWN" &&
      offer.dataCenters.length > 0,
    ),
    "Profil GPU tersedia pada snapshot katalog terbaru.",
    "Profil GPU belum tersedia pada cloud yang dipilih.",
  );
  check(
    "hourly_rate_limit",
    Boolean(
      hourlyRate !== null &&
      Number.isFinite(config.maximumHourlyRate) &&
      config.maximumHourlyRate > 0 &&
      hourlyRate <= config.maximumHourlyRate,
    ),
    "Tarif GPU berada di bawah batas harga per jam.",
    "Tarif GPU tidak tersedia atau melewati batas harga per jam.",
  );
  check(
    "first_cycle_cost_limit",
    Boolean(
      estimatedComputeCostUsd !== null &&
      Number.isFinite(config.hardCostLimitUsd) &&
      config.hardCostLimitUsd > 0 &&
      config.hardCostLimitUsd <= 25 &&
      estimatedComputeCostUsd <= config.hardCostLimitUsd,
    ),
    "Estimasi compute siklus pertama berada di bawah hard cost limit.",
    "Estimasi compute atau hard cost limit belum valid.",
  );
  check(
    "session_duration_limit",
    ALLOWED_DURATIONS.has(config.durationMinutes) &&
      ALLOWED_DURATIONS.has(config.maximumSessionMinutes) &&
      config.durationMinutes <= config.maximumSessionMinutes,
    "Durasi siklus pertama berada di bawah batas sesi.",
    "Durasi preflight atau batas sesi belum valid.",
  );
  check(
    "single_replica_confirmed",
    config.singleReplicaConfirmed,
    "Deployment satu replica telah dikonfirmasi.",
    "Satu replica belum dikonfirmasi melalui RUNPOD_SINGLE_REPLICA_CONFIRMED.",
  );
  check(
    "data_directory_accessible",
    dataDirectoryAccessible,
    "Direktori state tersedia dengan akses baca/tulis.",
    "VOXCPM_DATA_DIR tidak tersedia sebagai direktori baca/tulis.",
  );
  check(
    "persistent_state_confirmed",
    config.persistentStateConfirmed,
    "Persistensi state aplikasi dan watchdog telah dikonfirmasi.",
    "Persistent state belum dikonfirmasi melalui RUNPOD_PERSISTENT_STATE_CONFIRMED.",
  );
  check(
    "watchdog_deployed",
    config.watchdogDeployed,
    "Watchdog selalu aktif telah dikonfirmasi.",
    "Watchdog cloud belum dikonfirmasi melalui RUNPOD_WATCHDOG_DEPLOYED.",
  );
  check(
    "stop_alert_configured",
    config.stopAlertConfigured,
    "Alert kegagalan watchdog/stop telah dikonfigurasi.",
    "Alert stop belum dikonfirmasi melalui RUNPOD_STOP_ALERT_CONFIGURED.",
  );

  const failed = checks.filter((item) => !item.passed);
  return {
    ok: true,
    observedAt: now().toISOString(),
    readyForPaidCycle: failed.length === 0,
    safeDryRun: true,
    mutationAttempted: false,
    overviewObservedAt: overview?.observedAt ?? null,
    plan: {
      profileId: config.profileId,
      cloud,
      durationMinutes: config.durationMinutes,
      maximumHourlyRate: config.maximumHourlyRate,
      hourlyRate,
      estimatedComputeCostUsd,
      hardCostLimitUsd: config.hardCostLimitUsd,
      availability: offer?.availability ?? null,
      dataCenterConfigured: Boolean(config.dataCenterId),
      networkVolumeConfigured: Boolean(config.networkVolumeId),
    },
    checks,
    failedCheckIds: failed.map((item) => item.id),
    blockers: failed.map((item) => item.message),
  };
}
