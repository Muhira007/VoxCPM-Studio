"use client";

import {
  AudioLines,
  BookOpenText,
  Check,
  ChevronDown,
  Cpu,
  FileText,
  Headphones,
  Info,
  LoaderCircle,
  Play,
  Plus,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { readAudio } from "@/lib/audio-storage";
import { EXAMPLE_TEXT, GPU_LABELS, MODES, STYLES } from "@/lib/fixtures";
import { validateRequest } from "@/lib/demo-service";
import { AudioPreview } from "./audio-preview";
import { JobResult } from "./job-result";
import { useStudio } from "./studio-provider";
import { EmptyState, ErrorMessage, Modal, useToast, VoiceMark } from "./ui";
import { VoiceDialog } from "./voice-dialog";

export function StudioPage() {
  const { state, service } = useStudio();
  const { draft, session } = state;
  const [picker, setPicker] = useState(false);
  const [upload, setUpload] = useState(false);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const toast = useToast();
  const referenceMode = draft.mode === "clone" || draft.mode === "hifi";
  const selectedVoice = state.voices.find(
    (voice) => voice.id === draft.voiceId,
  );
  const busy = state.jobs.some((job) =>
    ["queued", "running"].includes(job.status),
  );
  const loadingGpu = ["provisioning", "loading", "stopping"].includes(
    session.status,
  );
  async function primaryAction() {
    setError("");
    try {
      if (session.status !== "ready") {
        await service.startSession();
        return;
      }
      const validation = validateRequest(draft, state.voices);
      if (validation) {
        setError(validation);
        return;
      }
      if (referenceMode && service.mode === "demo") {
        setChecking(true);
        if (!(await readAudio(draft.voiceId)))
          throw new Error(
            "Rekaman referensi tidak ditemukan. Tambahkan kembali melalui Pustaka Suara.",
          );
        if (service.getSnapshot().draft !== draft)
          throw new Error(
            "Naskah atau referensi berubah saat diperiksa. Jalankan kembali simulasi.",
          );
      }
      await service.generate();
    } catch (problem) {
      setError(
        problem instanceof Error
          ? problem.message
          : "Simulasi tidak dapat dimulai.",
      );
    } finally {
      setChecking(false);
    }
  }
  return (
    <div className="page studio-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">KREASIKAN SUARAMU</div>
          <h1>
            Suara untuk setiap cerita<span>.</span>
          </h1>
          <p>Mulai dari kata-kata. Hidupkan dengan karaktermu.</p>
        </div>
        <span className="model-badge">
          <span className="model-dot" /> VoxCPM2 <span>·</span> 48 kHz
        </span>
      </div>
      <div className="demo-notice">
        <Info size={17} />
        <p>
          <strong>
            {service.mode === "api"
              ? "Web UI terhubung ke API lokal."
              : "Kamu berada di Mode Demo."}
          </strong>{" "}
          Proses suara masih disimulasikan, tanpa memakai saldo.
        </p>
        <Link href="/gpu">
          Lihat sesi <span>→</span>
        </Link>
      </div>
      <div className="studio-grid">
        <section className="editor-panel panel">
          <div className="panel-heading">
            <div>
              <FileText size={18} />
              <h2>Naskah</h2>
            </div>
            <span className="language-label">
              <span className="indonesia-flag" />
              Bahasa Indonesia
            </span>
          </div>
          <div className="mode-tabs" role="group" aria-label="Mode sintesis">
            {MODES.map((mode) => (
              <button
                key={mode.id}
                aria-pressed={mode.id === draft.mode}
                onClick={() => {
                  service.updateDraft({ mode: mode.id });
                  setError("");
                }}
                className={mode.id === draft.mode ? "selected" : ""}
              >
                {mode.short}
              </button>
            ))}
          </div>
          <div className="text-editor">
            <label className="sr-only" htmlFor="script">
              Naskah suara
            </label>
            <textarea
              id="script"
              value={draft.text}
              maxLength={5000}
              onChange={(event) => {
                service.updateDraft({ text: event.target.value });
                if (error) setError("");
              }}
              placeholder="Ceritamu dimulai di sini…"
              aria-describedby="script-count"
            />
            <div className="editor-meta">
              <button
                className="text-button"
                onClick={() => {
                  service.updateDraft({ text: EXAMPLE_TEXT });
                  setError("");
                  toast("Contoh naskah dimuat.");
                }}
              >
                <BookOpenText size={15} />
                Gunakan contoh
              </button>
              <span id="script-count">
                {draft.text.length.toLocaleString("id-ID")} / 5.000 karakter
              </span>
            </div>
          </div>
          {draft.mode === "design" && (
            <div className="extra-input">
              <label className="field-label">
                Deskripsi karakter suara
                <textarea
                  value={draft.description}
                  rows={2}
                  maxLength={1000}
                  onChange={(event) =>
                    service.updateDraft({ description: event.target.value })
                  }
                  placeholder="Contoh: narator dengan suara hangat, tenang, dan artikulasi jelas."
                />
              </label>
              <p className="control-hint">
                Deskripsi gaya akan disesuaikan dengan format model pada
                integrasi GPU.
              </p>
            </div>
          )}
          {draft.mode === "hifi" && (
            <div className="extra-input">
              <label className="field-label">
                Transkrip rekaman referensi
                <textarea
                  value={draft.transcript}
                  rows={2}
                  maxLength={5000}
                  onChange={(event) =>
                    service.updateDraft({ transcript: event.target.value })
                  }
                  placeholder="Tulis persis ucapan dalam rekaman referensi…"
                />
              </label>
            </div>
          )}
          {(error || session.message) && (
            <div className="inline-error">
              <ErrorMessage>{error || session.message}</ErrorMessage>
            </div>
          )}
          <div className="editor-bottom">
            <div className="editor-tip">
              <Sparkles size={16} />
              <span>
                {loadingGpu
                  ? GPU_LABELS[session.status] + "…"
                  : service.mode === "api"
                    ? "Draft di browser; pekerjaan tersimpan di backend lokal."
                    : "Draft tersimpan otomatis di perangkat ini."}
              </span>
            </div>
            <button
              className="button primary"
              disabled={loadingGpu || busy || checking}
              onClick={() => void primaryAction()}
            >
              {loadingGpu || busy || checking ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Play size={15} fill="currentColor" />
              )}
              {busy
                ? "Sedang memproses…"
                : loadingGpu
                  ? GPU_LABELS[session.status]
                  : session.status === "ready"
                    ? "Jalankan simulasi"
                    : service.mode === "api"
                      ? "Siapkan worker lokal"
                      : "Siapkan sesi demo"}
            </button>
          </div>
        </section>
        <aside className="voice-panel panel">
          <div className="panel-heading">
            <div>
              <AudioLines size={18} />
              <h2>Karakter suara</h2>
            </div>
          </div>
          <div className="voice-controls">
            <label>{referenceMode ? "Referensi suara" : "Sumber suara"}</label>
            {referenceMode ? (
              <>
                <button
                  className="voice-selection"
                  onClick={() => setPicker(true)}
                >
                  <VoiceMark
                    small
                    color={
                      selectedVoice?.source === "upload"
                        ? selectedVoice.color
                        : "orange"
                    }
                  />
                  <span>
                    <strong>
                      {selectedVoice?.source === "upload"
                        ? selectedVoice.name
                        : "Pilih referensi suara"}
                    </strong>
                    <small>Rekaman lokal · Bahasa Indonesia</small>
                  </span>
                  <ChevronDown size={17} />
                </button>
                {selectedVoice?.source === "upload" && (
                  <AudioPreview
                    key={selectedVoice.id}
                    voiceId={selectedVoice.id}
                    audioUrl={selectedVoice.audioUrl}
                  />
                )}
              </>
            ) : (
              <div className="voice-selection static-selection">
                <VoiceMark
                  small
                  color={draft.mode === "design" ? "purple" : "orange"}
                />
                <span>
                  <strong>
                    {draft.mode === "design"
                      ? "Dari deskripsi suara"
                      : "Suara bawaan model"}
                  </strong>
                  <small>
                    {draft.mode === "design"
                      ? "Tanpa rekaman referensi"
                      : "Pemilihan suara masih simulasi"}
                  </small>
                </span>
                <Sparkles size={16} />
              </div>
            )}
            <div className="preset-label">
              <label>Gaya bicara</label>
              <span className="tag">Preset</span>
            </div>
            <div className="style-grid" role="group" aria-label="Gaya bicara">
              {STYLES.map((style) => (
                <button
                  key={style.id}
                  title={style.description}
                  aria-pressed={style.id === draft.style}
                  disabled={draft.mode === "hifi"}
                  onClick={() => service.updateDraft({ style: style.id })}
                  className={style.id === draft.style ? "selected" : ""}
                >
                  {style.label}
                </button>
              ))}
            </div>
            <p className="control-hint">
              {draft.mode === "hifi"
                ? "Hi-Fi mengikuti karakter rekaman. Instruksi gaya dinonaktifkan pada mode ini."
                : "Gaya diarahkan melalui deskripsi. Hasil dapat berbeda pada setiap suara."}
            </p>
            <div className="model-summary">
              <div>
                <span>Model</span>
                <strong>VoxCPM2</strong>
              </div>
              <div>
                <span>Keluaran target</span>
                <strong>WAV · 48 kHz</strong>
              </div>
              <div>
                <span>Status demo</span>
                <span
                  className={`status-pill ${session.status === "ready" ? "ready" : ""}`}
                >
                  <span />
                  {GPU_LABELS[session.status]}
                </span>
              </div>
            </div>
            <Link href="/voices" className="text-button library-link">
              Jelajahi pustaka suara <span>↗</span>
            </Link>
          </div>
        </aside>
      </div>
      <section className="result-panel panel" aria-live="polite">
        <div className="panel-heading">
          <div>
            <Headphones size={18} />
            <h2>Hasil audio</h2>
          </div>
          <span className="muted small">
            {state.jobs.length ? "Pekerjaan terakhir" : "Ruang dengar ceritamu"}
          </span>
        </div>
        {state.jobs[0] ? (
          <JobResult job={state.jobs[0]} />
        ) : (
          <EmptyState
            icon={<AudioLines size={28} />}
            title="Suaramu akan hadir di sini"
            description="Coba alur demo terlebih dahulu. Audio AI akan tersedia setelah integrasi model dan GPU."
          />
        )}
      </section>
      <div className="section-heading">
        <h2>Temukan karakter ceritamu</h2>
        <Link href="/voices">
          Semua suara <span>↗</span>
        </Link>
      </div>
      <div className="voice-preview-grid">
        {state.voices
          .filter((voice) => voice.source === "example")
          .map((voice) => (
            <button
              className="voice-preview"
              key={voice.id}
              onClick={() => {
                service.updateDraft({
                  mode: "design",
                  description: `${voice.name}. ${voice.description.replaceAll("·", ",")}`,
                });
                toast(`Karakter ${voice.name} dipakai untuk Voice Design.`);
              }}
            >
              <VoiceMark color={voice.color} />
              <div>
                <h3>{voice.name}</h3>
                <p>{voice.description}</p>
                <span>Inspirasi deskripsi · bukan rekaman</span>
              </div>
              <span className="voice-arrow">↗</span>
            </button>
          ))}
      </div>
      <div className="bottom-note">
        <Cpu size={15} />
        {service.mode === "api"
          ? "Web UI terhubung ke worker simulasi lokal. Belum ada GPU atau resource RunPod."
          : "GPU dinyalakan sesuai kebutuhan. Saat ini seluruh proses berjalan sebagai simulasi."}
      </div>
      <Modal
        open={picker}
        onOpenChange={setPicker}
        title="Pilih referensi suara"
        description="Gunakan rekaman lokal untuk mencoba alur cloning."
      >
        <div className="picker-list">
          {state.voices
            .filter((voice) => voice.source === "upload")
            .map((voice) => (
              <button
                key={voice.id}
                className="picker-option"
                onClick={() => {
                  service.updateDraft({ voiceId: voice.id });
                  setPicker(false);
                }}
              >
                <VoiceMark color={voice.color} small />
                <span>
                  <strong>{voice.name}</strong>
                  <small>{voice.description || voice.fileName}</small>
                </span>
                {voice.id === draft.voiceId && <Check size={17} />}
              </button>
            ))}
          {!state.voices.some((voice) => voice.source === "upload") && (
            <EmptyState
              icon={<AudioLines />}
              title="Belum ada referensi"
              description="Tambahkan rekaman suara dari perangkatmu untuk mulai mencoba cloning."
            />
          )}
        </div>
        <button
          className="button primary full"
          onClick={() => {
            setPicker(false);
            setUpload(true);
          }}
        >
          <Plus size={16} />
          Tambahkan referensi
        </button>
      </Modal>
      {upload && (
        <VoiceDialog
          open={upload}
          onOpenChange={setUpload}
          onCreated={(id) => service.updateDraft({ voiceId: id })}
        />
      )}
    </div>
  );
}
