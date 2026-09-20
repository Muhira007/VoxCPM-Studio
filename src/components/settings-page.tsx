"use client";

import {
  Check,
  Database,
  FlaskConical,
  Info,
  Settings2,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { clearAudio } from "@/lib/audio-storage";
import type { DemoScenario } from "@/lib/types";
import { useStudio } from "./studio-provider";
import { ErrorMessage, Modal, useToast } from "./ui";

export function SettingsPage() {
  const { state, service } = useStudio();
  const settings = state.settings;
  const [reset, setReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [price, setPrice] = useState(String(settings.maxHourlyRate));
  const toast = useToast();
  const scenarios: { id: DemoScenario; label: string }[] = [
    { id: "normal", label: "Normal — proses berhasil" },
    { id: "unavailable", label: "GPU tidak tersedia" },
    { id: "slow", label: "Pemuatan model lambat" },
    { id: "failure", label: "Pekerjaan sintesis gagal" },
    { id: "disconnected", label: "Koneksi worker terputus" },
  ];
  async function resetAll() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await clearAudio();
      service.resetLocalData();
      setPrice(String(service.getSnapshot().settings.maxHourlyRate));
      setReset(false);
      toast("Data lokal direset. Ruang kerja kembali ke pengaturan awal.");
    } catch (problem) {
      setError(
        problem instanceof Error
          ? problem.message
          : "Data lokal gagal direset.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page settings-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">SESUAIKAN RUANG KERJAMU</div>
          <h1>
            Atur, lalu fokus berkarya<span>.</span>
          </h1>
          <p>Preferensi ini hanya berlaku pada browser dan perangkat ini.</p>
        </div>
        <span className="saved-label">
          <Check size={15} />
          Tersimpan otomatis
        </span>
      </div>
      <section className="panel settings-section">
        <div className="panel-heading">
          <div>
            <Settings2 size={19} />
            <h2>Ruang kerja</h2>
          </div>
        </div>
        <div className="settings-row">
          <div>
            <strong>Bahasa antarmuka</strong>
            <p>Bahasa yang digunakan di seluruh aplikasi.</p>
          </div>
          <span className="setting-value">
            <span className="indonesia-flag" />
            Bahasa Indonesia
          </span>
        </div>
        <div className="settings-row">
          <div>
            <strong>Mode aplikasi</strong>
            <p>Seluruh kontrol GPU dan proses sintesis disimulasikan.</p>
          </div>
          <span className="demo-badge">
            <span />
            Mode Demo
          </span>
        </div>
        <div className="settings-row">
          <div>
            <strong>Integrasi RunPod</strong>
            <p>Disiapkan setelah saldo dan batas biaya tersedia.</p>
          </div>
          <span className="tag">Belum terhubung</span>
        </div>
      </section>
      <section className="panel settings-section">
        <div className="panel-heading">
          <div>
            <ShieldCheck size={19} />
            <h2>Preferensi sesi baru</h2>
          </div>
        </div>
        <div className="settings-row">
          <div>
            <strong>Durasi awal sesi</strong>
            <p>Berlaku untuk sesi demo berikutnya.</p>
          </div>
          <label className="sr-only" htmlFor="default-duration">
            Durasi awal sesi
          </label>
          <select
            id="default-duration"
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
            <strong>Idle timeout</strong>
            <p>Akhiri sesi ketika tidak ada pekerjaan aktif.</p>
          </div>
          <label className="sr-only" htmlFor="default-idle">
            Idle timeout
          </label>
          <select
            id="default-idle"
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
        <div className="settings-row">
          <div>
            <strong>Batas harga GPU</strong>
            <p>
              Profil dengan tarif contoh di atas batas ini tidak dapat dimulai.
            </p>
          </div>
          <form
            className="price-input"
            onSubmit={(event) => {
              event.preventDefault();
              if (
                !Number.isFinite(Number(price)) ||
                Number(price) < 0.01 ||
                Number(price) > 10
              )
                return;
              service.updateSettings({ maxHourlyRate: Number(price) });
              toast("Batas harga demo disimpan.");
            }}
          >
            <label className="sr-only" htmlFor="max-price">
              Batas harga GPU per jam dalam USD
            </label>
            <span>$</span>
            <input
              id="max-price"
              type="number"
              min="0.01"
              max="10"
              step="0.01"
              required
              value={price}
              onChange={(event) => setPrice(event.target.value)}
            />
            <button className="button small-button" type="submit">
              Simpan
            </button>
          </form>
        </div>
      </section>
      <section className="panel settings-section">
        <div className="panel-heading">
          <div>
            <FlaskConical size={19} />
            <h2>Skenario demo</h2>
          </div>
          <span className="tag">Untuk mencoba alur</span>
        </div>
        <div className="settings-row">
          <div>
            <strong>Perilaku simulasi</strong>
            <p>Perubahan berlaku pada sesi atau pekerjaan baru.</p>
          </div>
          <label className="sr-only" htmlFor="scenario">
            Skenario demo
          </label>
          <select
            id="scenario"
            value={settings.scenario}
            onChange={(event) =>
              service.updateSettings({
                scenario: event.target.value as DemoScenario,
              })
            }
          >
            {scenarios.map((item) => (
              <option value={item.id} key={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      </section>
      <section className="panel settings-section">
        <div className="panel-heading">
          <div>
            <Database size={19} />
            <h2>Data pada perangkat</h2>
          </div>
        </div>
        <div className="settings-row">
          <div>
            <strong>Draft, referensi, dan riwayat</strong>
            <p>
              {state.voices.filter((voice) => voice.source === "upload").length}{" "}
              referensi lokal · {state.jobs.length} pekerjaan demo. Data tidak
              disinkronkan ke cloud.
            </p>
          </div>
          <button
            className="button danger"
            onClick={() => {
              setError("");
              setReset(true);
            }}
          >
            <Trash2 size={15} />
            Reset data lokal
          </button>
        </div>
      </section>
      <p className="info-note">
        <Info size={17} />
        Jangan menyimpan API key pada halaman ini. Mode demo tidak membutuhkan
        kredensial apa pun.
      </p>
      <Modal
        open={reset}
        onOpenChange={(open) => {
          if (!busy) setReset(open);
        }}
        title="Reset seluruh data lokal?"
        description="Draft, rekaman referensi, riwayat, dan preferensi VoxCPM Studio di browser ini akan dihapus. Sesi demo yang berjalan akan dihentikan. Berkas asli di perangkat tetap ada."
      >
        {error && <ErrorMessage>{error}</ErrorMessage>}
        <div className="dialog-actions">
          <button
            className="button"
            disabled={busy}
            onClick={() => setReset(false)}
          >
            Batal
          </button>
          <button
            className="button danger"
            disabled={busy}
            onClick={() => void resetAll()}
          >
            {busy ? "Mereset…" : "Reset data lokal"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
