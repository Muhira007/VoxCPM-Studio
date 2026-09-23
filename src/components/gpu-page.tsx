"use client";

import {
  ArrowRight,
  Check,
  Cloud,
  Clock3,
  Cpu,
  Database,
  Info,
  LoaderCircle,
  MapPin,
  Play,
  Plus,
  Power,
  RefreshCw,
  Server,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatTime, GPU_LABELS, GPU_PROFILES } from "@/lib/fixtures";
import type { RunpodControlStatus } from "@/lib/runpod-control-types";
import type {
  RunpodCloud,
  RunpodDryRunPlan,
  RunpodOverview,
  RunpodProfileId,
} from "@/lib/runpod-types";
import { useStudio } from "./studio-provider";
import { ErrorMessage, Modal, useToast } from "./ui";

const AVAILABILITY_LABELS = {
  HIGH: "Tinggi",
  MEDIUM: "Sedang",
  LOW: "Rendah",
  NONE: "Tidak tersedia",
  UNKNOWN: "Tidak diketahui",
};

const RUNPOD_PHASE_LABELS: Record<RunpodControlStatus["phase"], string> = {
  off: "Belum ada sesi cloud",
  planned: "Pembuatan direncanakan",
  provisioning: "Pod sedang dibuat",
  starting: "Pod sedang dimulai",
  loading_model: "Model sedang dimuat",
  ready: "Worker cloud siap",
  stopping: "Stop sedang diverifikasi",
  stopped: "Pod sudah berhenti",
  error: "Kontrol perlu diperiksa",
};

const RUNPOD_STOP_LABELS = {
  manual: "Stop manual",
  hard_deadline: "Hard deadline",
  idle_deadline: "Idle timeout",
};

async function responseMessage(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => null)) as {
    message?: string;
  } | null;
  return payload?.message || fallback;
}

function formatEstimatedUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}

export function GpuPage() {
  const { state, service } = useStudio();
  const { session, settings } = state;
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const [runpodOverview, setRunpodOverview] = useState<RunpodOverview | null>(
    null,
  );
  const [runpodPlan, setRunpodPlan] = useState<RunpodDryRunPlan | null>(null);
  const [runpodControl, setRunpodControl] =
    useState<RunpodControlStatus | null>(null);
  const [runpodError, setRunpodError] = useState("");
  const [runpodLoading, setRunpodLoading] = useState(service.mode === "api");
  const [planLoading, setPlanLoading] = useState(service.mode === "api");
  const [cloud, setCloud] = useState<RunpodCloud>("community");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const toast = useToast();
  const active = !["off", "error"].includes(session.status);
  const transitioning = ["provisioning", "loading", "stopping"].includes(
    session.status,
  );
  const gpu = GPU_PROFILES.find(
    (item) =>
      item.id === (session.startedAt === null ? settings.gpuId : session.gpuId),
  )!;
  const elapsed =
    session.startedAt === null
      ? 0
      : Math.max(
          0,
          ((session.endedAt ?? state.now) - session.startedAt) / 1000,
        );
  const remaining =
    session.expiresAt === null ? 0 : (session.expiresAt - state.now) / 1000;
  const runpodHardRemaining = runpodControl?.session.hardDeadline
    ? (Date.parse(runpodControl.session.hardDeadline) - state.now) / 1000
    : null;
  const runpodIdleRemaining = runpodControl?.session.idleDeadline
    ? (Date.parse(runpodControl.session.idleDeadline) - state.now) / 1000
    : null;
  const runpodActiveJobs = runpodControl
    ? runpodControl.session.runningJobCount +
      runpodControl.session.queuedJobCount
    : 0;

  useEffect(() => {
    if (service.mode !== "api") return;
    const controller = new AbortController();
    void fetch(
      `/api/v1/runpod/overview${refreshVersion > 0 ? "?fresh=1" : ""}`,
      {
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      },
    )
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            await responseMessage(
              response,
              "Status baca RunPod tidak dapat dimuat.",
            ),
          );
        const payload = (await response.json()) as {
          overview: RunpodOverview;
          control: RunpodControlStatus;
        };
        setRunpodOverview(payload.overview);
        setRunpodControl(payload.control);
      })
      .catch((problem) => {
        if (!controller.signal.aborted)
          setRunpodError(
            problem instanceof Error
              ? problem.message
              : "Status baca RunPod tidak dapat dimuat.",
          );
        if (!controller.signal.aborted) setPlanLoading(false);
      })
      .finally(() => {
        if (!controller.signal.aborted) setRunpodLoading(false);
      });
    return () => controller.abort();
  }, [refreshVersion, service.mode]);

  useEffect(() => {
    if (service.mode !== "api") return;
    const controller = new AbortController();
    const interval = window.setInterval(() => {
      void fetch("/api/v1/runpod/control", {
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok)
            throw new Error(
              await responseMessage(
                response,
                "Status kontrol RunPod tidak dapat dimuat.",
              ),
            );
          const payload = (await response.json()) as {
            control: RunpodControlStatus;
          };
          setRunpodControl(payload.control);
        })
        .catch((problem) => {
          if (!controller.signal.aborted)
            setRunpodError(
              problem instanceof Error
                ? problem.message
                : "Status kontrol RunPod tidak dapat dimuat.",
            );
        });
    }, 10_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [service.mode]);

  useEffect(() => {
    if (service.mode !== "api" || !runpodOverview) return;
    const controller = new AbortController();
    const profileId = settings.gpuId as RunpodProfileId;
    void fetch("/api/v1/runpod/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
      body: JSON.stringify({
        profileId,
        cloud,
        durationMinutes: settings.sessionMinutes,
        maximumHourlyRate: settings.maxHourlyRate,
      }),
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            await responseMessage(
              response,
              "Rencana dry-run tidak dapat dihitung.",
            ),
          );
        const payload = (await response.json()) as { plan: RunpodDryRunPlan };
        setRunpodPlan(payload.plan);
      })
      .catch((problem) => {
        if (!controller.signal.aborted) {
          setRunpodPlan(null);
          setRunpodError(
            problem instanceof Error
              ? problem.message
              : "Rencana dry-run tidak dapat dihitung.",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setPlanLoading(false);
      });
    return () => controller.abort();
  }, [
    cloud,
    runpodOverview,
    service.mode,
    settings.gpuId,
    settings.maxHourlyRate,
    settings.sessionMinutes,
  ]);
  async function start() {
    setError("");
    try {
      await service.startSession();
    } catch (problem) {
      setError(
        problem instanceof Error ? problem.message : "Sesi gagal dimulai.",
      );
    }
  }
  async function extend() {
    setError("");
    try {
      await service.extendSession();
      toast("Sesi demo diperpanjang 30 menit.");
    } catch (problem) {
      setError(
        problem instanceof Error ? problem.message : "Perpanjangan gagal.",
      );
    }
  }
  const stages = [
    { key: "provisioning", label: "GPU aktif", note: "Menyiapkan sesi" },
    { key: "loading", label: "Model dimuat", note: "Menyiapkan VoxCPM2" },
    { key: "ready", label: "Siap digunakan", note: "Studio menerima naskah" },
  ];
  const stage = stages.findIndex((item) => item.key === session.status);
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">KENDALI DI TANGANMU</div>
          <h1>
            GPU saat kamu membutuhkannya<span>.</span>
          </h1>
          <p>Siapkan sesi, atur waktunya, lalu kembali berkarya.</p>
        </div>
        <span className="demo-badge">
          <span />
          {service.mode === "api" ? "Worker lokal" : "Sesi simulasi"}
        </span>
      </div>
      <div className="demo-notice">
        <Info size={17} />
        <p>
          Kontrol sesi dan timer di bawah tetap <strong>simulasi lokal</strong>{" "}
          {service.mode === "api"
            ? "melalui API. Panel RunPod hanya membaca inventaris dan katalog; tidak ada aksi cloud."
            : "di browser dan tidak terhubung ke RunPod."}
        </p>
      </div>
      {service.mode === "api" && (
        <section className="panel runpod-panel" aria-labelledby="runpod-title">
          <div className="runpod-heading">
            <div className="runpod-title">
              <span className="runpod-icon">
                <Cloud size={20} />
              </span>
              <div>
                <span className="eyebrow">RUNPOD REST API V2</span>
                <h2 id="runpod-title">Status akun baca saja</h2>
              </div>
            </div>
            <div className="runpod-heading-actions">
              <span className="read-only-badge">
                <ShieldCheck size={14} /> Read only
              </span>
              <button
                className="button compact"
                disabled={runpodLoading || planLoading}
                onClick={() => {
                  setRunpodLoading(true);
                  setPlanLoading(true);
                  setRunpodPlan(null);
                  setRunpodError("");
                  setRefreshVersion((value) => value + 1);
                }}
              >
                <RefreshCw className={runpodLoading ? "spin" : ""} size={15} />
                Segarkan
              </button>
            </div>
          </div>
          {runpodError && (
            <div className="runpod-error">
              <ErrorMessage>{runpodError}</ErrorMessage>
            </div>
          )}
          {runpodLoading && !runpodOverview ? (
            <div className="runpod-loading" role="status">
              <LoaderCircle className="spin" size={18} />
              Membaca inventaris dan katalog RunPod…
            </div>
          ) : runpodOverview ? (
            <>
              <div className="runpod-stats">
                <div>
                  <Server size={18} />
                  <span>Pod di akun</span>
                  <strong>{runpodOverview.inventory.podCount}</strong>
                  <small>Tidak membuat atau mengubah Pod</small>
                </div>
                <div>
                  <Cpu size={18} />
                  <span>Tipe GPU</span>
                  <strong>{runpodOverview.catalog.gpuTypeCount}</strong>
                  <small>
                    Minimum CUDA {runpodOverview.minimumCudaVersion}
                  </small>
                </div>
                <div>
                  <Database size={18} />
                  <span>Data center</span>
                  <strong>{runpodOverview.catalog.dataCenterCount}</strong>
                  <small>Network Volume dipilih</small>
                </div>
              </div>
              {runpodControl && (
                <div
                  className="runpod-guard"
                  aria-label="Pengaman kontrol RunPod"
                >
                  <div className="runpod-guard-heading">
                    <div>
                      <ShieldCheck size={18} />
                      <span>
                        <strong>Pengaman operasi berbayar</strong>
                        <small>
                          State machine siap diuji, mutation nyata tetap
                          terkunci.
                        </small>
                      </span>
                    </div>
                    <span className="write-lock-badge">
                      {runpodControl.writeEnabled ? "Aktif" : "Terkunci"}
                    </span>
                  </div>
                  <div className="runpod-guard-grid">
                    <div>
                      <span>Storage persisten</span>
                      <strong>
                        Standard Network Volume · {runpodControl.storage.sizeGb}{" "}
                        GB
                      </strong>
                      <small>
                        {runpodControl.storage.mountPath} · estimasi $
                        {runpodControl.storage.estimatedMonthlyUsd.toFixed(2)}
                        /bulan
                      </small>
                    </div>
                    <div>
                      <span>Batas & drain</span>
                      <strong>
                        {runpodControl.limits.maximumSessionMinutes} menit · $
                        {runpodControl.limits.hardCostLimitUsd.toFixed(2)}
                      </strong>
                      <small>
                        Tolak job baru{" "}
                        {formatTime(
                          runpodControl.limits.admissionCutoffSeconds,
                        )}{" "}
                        sebelum tenggat
                      </small>
                    </div>
                    <div>
                      <span>Countdown cloud</span>
                      <strong>
                        Hard{" "}
                        {runpodHardRemaining === null
                          ? "—"
                          : formatTime(runpodHardRemaining)}
                      </strong>
                      <small>
                        Idle{" "}
                        {runpodIdleRemaining !== null
                          ? formatTime(runpodIdleRemaining)
                          : runpodActiveJobs > 0
                            ? `ditahan ${runpodActiveJobs} job`
                            : "—"}
                      </small>
                    </div>
                    <div>
                      <span>Status kontrol</span>
                      <strong>
                        {runpodControl.session.stopReason
                          ? RUNPOD_STOP_LABELS[runpodControl.session.stopReason]
                          : runpodControl.session.drainStartedAt
                            ? "Drain hard deadline"
                            : RUNPOD_PHASE_LABELS[runpodControl.phase]}
                      </strong>
                      <small>
                        {runpodControl.session.drainStartedAt
                          ? `${runpodControl.session.cancelledJobCount} ditandai batal · ${runpodControl.session.cancellationFailureCount} worker gagal`
                          : runpodControl.storage.volumeConfigured &&
                              runpodControl.storage.dataCenterConfigured
                            ? "Volume dan lokasi siap"
                            : "Volume / lokasi belum diisi"}
                      </small>
                    </div>
                  </div>
                  <div className="runpod-cost-ledger">
                    <div className="runpod-cost-heading">
                      <strong>Ledger estimasi biaya</strong>
                      <small>
                        Berdasarkan timestamp control plane · bukan tagihan
                        RunPod
                      </small>
                    </div>
                    <div className="runpod-cost-grid">
                      <div>
                        <span>Compute terakumulasi</span>
                        <strong>
                          {formatEstimatedUsd(
                            runpodControl.costEstimate.accruedComputeCostUsd,
                          )}
                        </strong>
                        <small>
                          {formatTime(runpodControl.costEstimate.totalSeconds)}{" "}
                          ·{" "}
                          {runpodControl.costEstimate.hourlyRate === null
                            ? "tarif belum ada"
                            : `$${runpodControl.costEstimate.hourlyRate.toFixed(2)}/jam`}
                        </small>
                      </div>
                      <div>
                        <span>Startup / loading</span>
                        <strong>
                          {formatEstimatedUsd(
                            runpodControl.costEstimate.startup.estimatedCostUsd,
                          )}
                        </strong>
                        <small>
                          {formatTime(
                            runpodControl.costEstimate.startup.seconds,
                          )}
                        </small>
                      </div>
                      <div>
                        <span>Job aktif / idle</span>
                        <strong>
                          {formatEstimatedUsd(
                            runpodControl.costEstimate.active.estimatedCostUsd,
                          )}{" "}
                          /{" "}
                          {formatEstimatedUsd(
                            runpodControl.costEstimate.idle.estimatedCostUsd,
                          )}
                        </strong>
                        <small>
                          Shutdown/error{" "}
                          {formatEstimatedUsd(
                            runpodControl.costEstimate.shutdown
                              .estimatedCostUsd,
                          )}
                        </small>
                      </div>
                      <div>
                        <span>Exposure sampai hard deadline</span>
                        <strong>
                          +
                          {formatEstimatedUsd(
                            runpodControl.costEstimate
                              .remainingComputeExposureUsd,
                          )}
                        </strong>
                        <small>
                          Proyeksi compute{" "}
                          {formatEstimatedUsd(
                            runpodControl.costEstimate.projectedComputeCostUsd,
                          )}
                        </small>
                      </div>
                    </div>
                    <p>
                      {runpodControl.storage.volumeConfigured
                        ? "Storage Network Volume "
                        : "Rencana storage Network Volume "}
                      <strong>
                        $
                        {runpodControl.costEstimate.storageMonthlyCostUsd.toFixed(
                          2,
                        )}
                        /bulan
                      </strong>
                      {runpodControl.storage.volumeConfigured
                        ? " dihitung terpisah dan tetap berjalan ketika compute berhenti."
                        : " belum dikenakan karena volume belum dibuat."}
                    </p>
                  </div>
                </div>
              )}
              <div className="runpod-plan-controls">
                <div>
                  <strong>Rencana RunPod</strong>
                  <p>
                    Perhitungan lokal dari katalog terbaru. Tidak mengirim
                    mutation.
                  </p>
                </div>
                <label htmlFor="runpod-cloud">
                  Jenis cloud
                  <select
                    id="runpod-cloud"
                    value={cloud}
                    onChange={(event) => {
                      setPlanLoading(true);
                      setRunpodPlan(null);
                      setRunpodError("");
                      setCloud(event.target.value as RunpodCloud);
                    }}
                  >
                    <option value="community">Community Cloud</option>
                    <option value="secure">Secure Cloud</option>
                  </select>
                </label>
              </div>
              {runpodPlan && (
                <div className="runpod-dry-run" aria-busy={planLoading}>
                  <div className="dry-run-summary">
                    <span>
                      {planLoading ? (
                        <LoaderCircle className="spin" size={16} />
                      ) : (
                        <ShieldCheck size={16} />
                      )}
                      Dry-run · tidak membuat resource
                    </span>
                    <strong>
                      {runpodPlan.hourlyRate === null
                        ? "Tarif tidak tersedia"
                        : `$${runpodPlan.hourlyRate.toFixed(2)}/jam`}
                    </strong>
                    <small>
                      Estimasi {runpodPlan.durationMinutes} menit:{" "}
                      {runpodPlan.estimatedComputeCost === null
                        ? "—"
                        : `$${runpodPlan.estimatedComputeCost.toFixed(2)}`}
                    </small>
                  </div>
                  <div className="dry-run-details">
                    <div>
                      <span>Ketersediaan</span>
                      <strong>
                        {AVAILABILITY_LABELS[runpodPlan.availability]}
                      </strong>
                    </div>
                    <div>
                      <span>Batas harga</span>
                      <strong>
                        {runpodPlan.checks.rateWithinLimit
                          ? `Lulus · ≤ $${runpodPlan.maximumHourlyRate.toFixed(2)}`
                          : `Melewati $${runpodPlan.maximumHourlyRate.toFixed(2)}`}
                      </strong>
                    </div>
                    <div>
                      <span>Lokasi tersedia</span>
                      <strong>
                        <MapPin size={14} />
                        {runpodPlan.dataCenters.length
                          ? runpodPlan.dataCenters.join(", ")
                          : "Belum ada"}
                      </strong>
                    </div>
                  </div>
                  <ul className="dry-run-blockers">
                    {runpodPlan.blockers.map((blocker) => (
                      <li key={blocker}>{blocker}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="runpod-observed">
                Dibaca{" "}
                {new Date(runpodOverview.observedAt).toLocaleString("id-ID")}
                {" · "}saldo tidak dibaca oleh endpoint ini.
              </p>
            </>
          ) : null}
        </section>
      )}
      <section className="session-panel panel">
        <div className="session-status-heading">
          <div
            className={`gpu-symbol ${session.status === "ready" ? "ready" : ""}`}
          >
            <Cpu size={29} />
          </div>
          <div>
            <span
              className={`status-pill ${session.status === "ready" ? "ready" : ""}`}
            >
              <span />
              {GPU_LABELS[session.status]}
            </span>
            <h2>
              {gpu.name} <span>{gpu.memory} VRAM</span>
            </h2>
          </div>
          <div className="session-actions">
            {active ? (
              <button
                className="button"
                disabled={session.status === "stopping"}
                onClick={() => setConfirm(true)}
              >
                <Power size={16} />
                Akhiri sesi
              </button>
            ) : (
              <button className="button primary" onClick={() => void start()}>
                <Play size={16} fill="currentColor" />
                Mulai sesi demo
              </button>
            )}
          </div>
        </div>
        <div className="session-stages">
          {stages.map((item, index) => (
            <div
              className={`session-stage ${stage >= index ? "reached" : ""}`}
              key={item.key}
            >
              <span>
                {stage > index || session.status === "ready" ? (
                  <Check size={16} />
                ) : stage === index && transitioning ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  index + 1
                )}
              </span>
              <div>
                <strong>{item.label}</strong>
                <small>{item.note}</small>
              </div>
            </div>
          ))}
        </div>
        <div className="session-metrics">
          <div>
            <span>
              <Clock3 size={15} />
              Waktu sesi
            </span>
            <strong>{formatTime(elapsed)}</strong>
            <small>Sejak sesi demo dimulai</small>
          </div>
          <div>
            <span>
              <Power size={15} />
              Sisa waktu
            </span>
            <strong>{active ? formatTime(remaining) : "—"}</strong>
            <button
              className="text-button accent"
              disabled={!active || session.status === "stopping"}
              onClick={() => void extend()}
            >
              <Plus size={13} />
              Tambah 30 menit
            </button>
          </div>
          <div>
            <span>Estimasi biaya demo</span>
            <strong>${((elapsed / 3600) * gpu.rate).toFixed(4)}</strong>
            <small>Simulasi ${gpu.rate.toFixed(2)}/jam · bukan tagihan</small>
          </div>
        </div>
        {(error || session.message) && (
          <div className="inline-error">
            <ErrorMessage>{error || session.message}</ErrorMessage>
          </div>
        )}
        {session.status === "ready" && (
          <div className="session-ready">
            <span>
              <Check size={17} />
              Model demo siap. Mulai dengan naskahmu.
            </span>
            <Link className="text-button accent" href="/">
              Buka Studio <ArrowRight size={16} />
            </Link>
          </div>
        )}
      </section>
      <div className="section-heading">
        <h2>Pilih profil GPU</h2>
        <span className="small muted">
          {runpodOverview
            ? `Harga RunPod ${cloud === "community" ? "Community" : "Secure"}`
            : "Tarif contoh untuk simulasi"}
        </span>
      </div>
      <div className="gpu-profile-grid">
        {GPU_PROFILES.map((profile) => {
          const liveProfile = runpodOverview?.catalog.profiles.find(
            (item) => item.profileId === profile.id,
          );
          const liveOffer = liveProfile?.offers[cloud];
          return (
            <button
              disabled={active}
              key={profile.id}
              className={`gpu-profile panel ${settings.gpuId === profile.id ? "selected" : ""}`}
              aria-pressed={settings.gpuId === profile.id}
              onClick={() => {
                if (service.mode === "api") {
                  setPlanLoading(true);
                  setRunpodPlan(null);
                  setRunpodError("");
                }
                service.updateSettings({ gpuId: profile.id });
                setError("");
              }}
            >
              <span className="profile-radio">
                {settings.gpuId === profile.id && <Check size={12} />}
              </span>
              <Cpu size={22} />
              <span className="gpu-profile-name">{profile.name}</span>
              <span className="gpu-profile-memory">
                {profile.memory} VRAM · {profile.detail}
              </span>
              <span className="gpu-profile-price">
                {liveOffer?.hourlyRate === null || liveOffer === undefined
                  ? `$${profile.rate.toFixed(2)}`
                  : `$${liveOffer.hourlyRate.toFixed(2)}`}
                <small>{liveOffer ? "/ jam RunPod" : "/ jam demo"}</small>
              </span>
              {liveOffer && (
                <span
                  className={`live-availability ${liveOffer.availability.toLowerCase()}`}
                >
                  {AVAILABILITY_LABELS[liveOffer.availability]} · data langsung
                </span>
              )}
            </button>
          );
        })}
      </div>
      <section className="panel settings-section">
        <div className="panel-heading">
          <div>
            <ShieldCheck size={19} />
            <h2>Batas sesi</h2>
          </div>
          <Link href="/settings" className="text-button">
            Semua pengaturan →
          </Link>
        </div>
        <div className="settings-row">
          <div>
            <strong>Durasi sesi baru</strong>
            <p>Perpanjangan dibatasi total empat jam.</p>
          </div>
          <label className="sr-only" htmlFor="session-duration">
            Durasi sesi baru
          </label>
          <select
            id="session-duration"
            disabled={active}
            value={settings.sessionMinutes}
            onChange={(event) => {
              if (service.mode === "api") {
                setPlanLoading(true);
                setRunpodPlan(null);
                setRunpodError("");
              }
              service.updateSettings({
                sessionMinutes: Number(event.target.value),
              });
            }}
          >
            {[30, 60, 120, 240].map((value) => (
              <option key={value} value={value}>
                {value} menit
              </option>
            ))}
          </select>
        </div>
        <div className="settings-row">
          <div>
            <strong>Berhenti saat menganggur</strong>
            <p>Tidak menghentikan pekerjaan yang sedang diproses.</p>
          </div>
          <label className="sr-only" htmlFor="idle-duration">
            Batas waktu menganggur
          </label>
          <select
            id="idle-duration"
            value={settings.idleMinutes}
            onChange={(event) =>
              service.updateSettings({
                idleMinutes: Number(event.target.value),
              })
            }
          >
            {[5, 10, 15, 30].map((value) => (
              <option key={value} value={value}>
                {value} menit
              </option>
            ))}
          </select>
        </div>
      </section>
      <p className="info-note">
        <Info size={17} />
        Timer demo berjalan selama halaman terbuka. Ini belum menjadi pengaman
        biaya cloud. Versi RunPod akan menggunakan pengawas terpisah di cloud.
      </p>
      <Modal
        open={confirm}
        onOpenChange={setConfirm}
        title="Akhiri sesi demo?"
        description="Pekerjaan yang masih berjalan akan dibatalkan. Draft, referensi, dan riwayat tetap tersimpan."
      >
        <div className="dialog-actions">
          <button className="button" onClick={() => setConfirm(false)}>
            Kembali
          </button>
          <button
            className="button primary"
            onClick={() => {
              void Promise.resolve(service.stopSession())
                .then(() => {
                  setConfirm(false);
                  toast("Sesi simulasi diakhiri.");
                })
                .catch((problem) =>
                  setError(
                    problem instanceof Error
                      ? problem.message
                      : "Sesi gagal diakhiri.",
                  ),
                );
            }}
          >
            <Power size={16} />
            Akhiri sesi
          </button>
        </div>
      </Modal>
    </div>
  );
}
