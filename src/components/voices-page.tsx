"use client";

import {
  AudioLines,
  BookAudio,
  Check,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { removeAudio } from "@/lib/audio-storage";
import { formatTime } from "@/lib/fixtures";
import type { Voice } from "@/lib/types";
import { AudioPreview } from "./audio-preview";
import { useStudio } from "./studio-provider";
import { EmptyState, ErrorMessage, Modal, useToast, VoiceMark } from "./ui";
import { VoiceDialog } from "./voice-dialog";

export function VoicesPage() {
  const { state, service } = useStudio();
  const router = useRouter();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [upload, setUpload] = useState(false);
  const [editing, setEditing] = useState<Voice | undefined>();
  const [detail, setDetail] = useState<Voice | null>(null);
  const [deleting, setDeleting] = useState<Voice | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const voices = state.voices.filter(
    (voice) =>
      (filter === "all" || voice.source === filter) &&
      `${voice.name} ${voice.description}`
        .toLocaleLowerCase("id")
        .includes(search.toLocaleLowerCase("id")),
  );
  function chooseVoice(voice: Voice) {
    service.updateDraft(
      voice.source === "upload"
        ? { voiceId: voice.id, mode: "clone" }
        : {
            mode: "design",
            description: `${voice.name}. ${voice.description.replaceAll("·", ",")}`,
          },
    );
    router.push("/");
    toast(
      voice.source === "upload"
        ? "Referensi dipilih untuk cloning."
        : "Deskripsi suara dimuat di Studio.",
    );
  }
  async function confirmDelete() {
    if (!deleting || busy) return;
    setBusy(true);
    setError("");
    try {
      if (service.mode === "demo") await removeAudio(deleting.id);
      await service.removeVoice(deleting.id);
      setDeleting(null);
      setDetail(null);
      toast(
        service.mode === "api"
          ? "Referensi dihapus dari backend lokal."
          : "Referensi dihapus dari browser ini.",
      );
    } catch (problem) {
      setError(
        problem instanceof Error ? problem.message : "Referensi gagal dihapus.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">PUSTAKA PRIBADI</div>
          <h1>
            Setiap suara, satu karakter<span>.</span>
          </h1>
          <p>
            Simpan referensimu dan temukan karakter untuk cerita berikutnya.
          </p>
        </div>
        <button
          className="button primary"
          onClick={() => {
            setEditing(undefined);
            setUpload(true);
          }}
        >
          <Plus size={17} />
          Tambah suara
        </button>
      </div>
      <div className="toolbar">
        <div
          className="filter-tabs"
          role="group"
          aria-label="Filter sumber suara"
        >
          {[
            { id: "all", name: "Semua suara" },
            { id: "upload", name: "Referensi saya" },
            { id: "example", name: "Inspirasi" },
          ].map((item) => (
            <button
              key={item.id}
              aria-pressed={filter === item.id}
              className={filter === item.id ? "selected" : ""}
              onClick={() => setFilter(item.id)}
            >
              {item.name}
              {item.id === "all" && <span>{state.voices.length}</span>}
            </button>
          ))}
        </div>
        <label className="search-field">
          <Search size={17} />
          <input
            aria-label="Cari suara"
            placeholder="Cari suara…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>
      {voices.length ? (
        <div className="voice-card-grid">
          {voices.map((voice) => (
            <article className="voice-card panel" key={voice.id}>
              <div className={`voice-card-top ${voice.color}`}>
                <VoiceMark color={voice.color} />
                <span className="source-label">
                  {voice.source === "upload"
                    ? "Referensi lokal"
                    : "Inspirasi deskripsi"}
                </span>
                {voice.source === "upload" && (
                  <div className="card-tools">
                    <button
                      className="icon-button"
                      aria-label={`Edit ${voice.name}`}
                      onClick={() => {
                        setEditing(voice);
                        setUpload(true);
                      }}
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Hapus ${voice.name}`}
                      onClick={() => {
                        setError("");
                        setDeleting(voice);
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                )}
              </div>
              <div className="voice-card-body">
                <h2>{voice.name}</h2>
                <p>{voice.description || "Referensi suara pribadi"}</p>
                <div className="voice-card-meta">
                  <span className="indonesia-flag" />
                  {voice.source === "upload"
                    ? `${formatTime(voice.duration ?? 0)} · Rekaman asli`
                    : "Contoh karakter · tanpa rekaman"}
                </div>
                <div className="voice-card-actions">
                  <button
                    className="button small-button"
                    onClick={() => setDetail(voice)}
                  >
                    {voice.source === "upload" ? (
                      <AudioLines size={15} />
                    ) : (
                      <BookAudio size={15} />
                    )}
                    Detail
                  </button>
                  <button
                    className="text-button accent"
                    onClick={() => chooseVoice(voice)}
                  >
                    Gunakan <span>→</span>
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="panel">
          <EmptyState
            icon={<BookAudio size={28} />}
            title={
              search ? "Suara tidak ditemukan" : "Pustaka suaramu masih kosong"
            }
            description={
              search
                ? "Coba kata kunci lain atau tampilkan semua suara."
                : "Tambahkan rekaman pertamamu. Referensi akan tersimpan di perangkat ini."
            }
          >
            {!search && (
              <button
                className="button primary"
                onClick={() => {
                  setEditing(undefined);
                  setUpload(true);
                }}
              >
                <Plus size={16} />
                Tambah suara
              </button>
            )}
          </EmptyState>
        </div>
      )}
      <div className="info-note">
        <Sparkles size={17} />
        <span>
          Inspirasi berisi contoh deskripsi, bukan suara yang sudah dihasilkan.
          Referensi lokal dapat diputar, tetapi tidak diunggah ke cloud.
        </span>
      </div>
      {upload && (
        <VoiceDialog
          key={editing?.id ?? "new"}
          open={upload}
          onOpenChange={setUpload}
          voice={editing}
        />
      )}
      <Modal
        open={!!detail}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
        title={detail?.name ?? "Detail suara"}
        description={
          detail?.source === "upload"
            ? "Rekaman referensi yang tersimpan di perangkatmu."
            : "Inspirasi untuk deskripsi Voice Design."
        }
      >
        {detail && (
          <div className="form-stack">
            <div className="voice-detail-heading">
              <VoiceMark color={detail.color} />
              <p>{detail.description || "Tidak ada catatan tambahan."}</p>
            </div>
            {detail.source === "upload" ? (
              <>
                <AudioPreview
                  key={detail.id}
                  voiceId={detail.id}
                  audioUrl={detail.audioUrl}
                />
                <p className="small muted">
                  {detail.fileName} · {formatTime(detail.duration ?? 0)}
                </p>
              </>
            ) : (
              <p className="info-note">
                Belum ada rekaman untuk karakter ini. Gunakan deskripsinya di
                Studio untuk mencoba alur Voice Design.
              </p>
            )}
            <button
              className="button primary full"
              onClick={() => chooseVoice(detail)}
            >
              <Check size={16} />
              Gunakan di Studio
            </button>
          </div>
        )}
      </Modal>
      <Modal
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(null);
        }}
        title="Hapus referensi suara?"
        description={`Rekaman dan detail ${deleting?.name ?? "suara ini"} akan dihapus dari browser ini. Berkas asli di perangkat tidak diubah.`}
      >
        {error && <ErrorMessage>{error}</ErrorMessage>}
        <div className="dialog-actions">
          <button
            className="button"
            disabled={busy}
            onClick={() => setDeleting(null)}
          >
            Batal
          </button>
          <button
            className="button danger"
            disabled={busy}
            onClick={() => void confirmDelete()}
          >
            <Trash2 size={16} />
            {busy ? "Menghapus…" : "Hapus referensi"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
