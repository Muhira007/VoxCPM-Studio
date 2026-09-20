"use client";

import {
  ArrowRight,
  Check,
  Clock3,
  Cpu,
  Info,
  LoaderCircle,
  Play,
  Plus,
  Power,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { formatTime, GPU_LABELS, GPU_PROFILES } from "@/lib/fixtures";
import { useStudio } from "./studio-provider";
import { ErrorMessage, Modal, useToast } from "./ui";

export function GpuPage() {
  const { state, service } = useStudio();
  const { session, settings } = state;
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
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
  function start() {
    setError("");
    try {
      service.startSession();
    } catch (problem) {
      setError(
        problem instanceof Error ? problem.message : "Sesi gagal dimulai.",
      );
    }
  }
  function extend() {
    setError("");
    try {
      service.extendSession();
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
          Sesi simulasi
        </span>
      </div>
      <div className="demo-notice">
        <Info size={17} />
        <p>
          Seluruh status dan biaya di halaman ini adalah{" "}
          <strong>simulasi lokal</strong>. Tidak terhubung ke RunPod.
        </p>
      </div>
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
              <button className="button primary" onClick={start}>
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
              onClick={extend}
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
        <span className="small muted">Tarif contoh untuk simulasi</span>
      </div>
      <div className="gpu-profile-grid">
        {GPU_PROFILES.map((profile) => (
          <button
            disabled={active}
            key={profile.id}
            className={`gpu-profile panel ${settings.gpuId === profile.id ? "selected" : ""}`}
            aria-pressed={settings.gpuId === profile.id}
            onClick={() => {
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
              ${profile.rate.toFixed(2)}
              <small>/ jam demo</small>
            </span>
          </button>
        ))}
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
            onChange={(event) =>
              service.updateSettings({
                sessionMinutes: Number(event.target.value),
              })
            }
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
              service.stopSession();
              setConfirm(false);
              toast("Sesi demo diakhiri.");
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
