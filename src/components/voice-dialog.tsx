"use client";

import { Check, Upload, UploadCloud } from "lucide-react";
import { useState, type FormEvent } from "react";
import { inspectReferenceAudio, type AudioQualityReport } from "@/lib/audio-analysis";
import { saveAudio } from "@/lib/audio-storage";
import { formatTime } from "@/lib/fixtures";
import type { Voice } from "@/lib/types";
import { useStudio } from "./studio-provider";
import { ErrorMessage, Modal, useToast } from "./ui";
import { AudioQualityPanel, RecordingGuide } from "./reference-quality";

export function VoiceDialog({
  open,
  onOpenChange,
  voice,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  voice?: Voice;
  onCreated?: (id: string) => void;
}) {
  const { service } = useStudio();
  const toast = useToast();
  const [name, setName] = useState(voice?.name ?? "");
  const [description, setDescription] = useState(voice?.description ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState(0);
  const [analysis, setAnalysis] = useState<AudioQualityReport | undefined>(
    voice?.analysis,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function selectFile(selected: File | undefined) {
    if (!selected) return;
    setError("");
    setBusy(true);
    setFile(null);
    setAnalysis(undefined);
    try {
      const report = await inspectReferenceAudio(selected);
      setFile(selected);
      setDuration(report.durationSeconds);
      setAnalysis(report);
      if (!name) setName(selected.name.replace(/\.[^.]+$/, "").slice(0, 60));
    } catch (problem) {
      setError(
        problem instanceof Error ? problem.message : "Audio gagal dibaca.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!name.trim()) {
      setError("Beri nama referensi suara ini.");
      return;
    }
    if (!voice && !file) {
      setError("Pilih rekaman referensi terlebih dahulu.");
      return;
    }
    if (!voice && analysis?.status === "fail") {
      setError("Rekaman masih memiliki masalah bertanda gagal. Pilih atau rekam ulang audio.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      if (voice)
        await service.editVoice(voice.id, name.trim(), description.trim());
      else if (file) {
        const id = crypto.randomUUID();
        if (service.mode === "demo") await saveAudio(id, file);
        const createdId = await service.addVoice({
          id,
          name: name.trim(),
          description: description.trim(),
          source: "upload",
          color: "green",
          duration,
          fileName: file.name,
          analysis,
          createdAt: Date.now(),
        }, file);
        onCreated?.(createdId);
      }
      toast(
        voice
          ? "Detail suara diperbarui."
          : service.mode === "api"
            ? "Referensi tersimpan di backend lokal."
            : "Referensi tersimpan di browser ini.",
      );
      onOpenChange(false);
    } catch (problem) {
      setError(
        problem instanceof Error
          ? problem.message
          : "Referensi gagal disimpan.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
      title={voice ? "Edit referensi suara" : "Tambahkan suaramu"}
      description={`Rekaman disimpan ${service.mode === "api" ? "pada backend lokal" : "di browser"}. Gunakan suara milikmu atau yang kamu punya izin untuk gunakan.`}
    >
      <form onSubmit={submit} className="form-stack">
        {!voice && (
          <label className={`upload-zone ${busy ? "is-busy" : ""}`}>
            <input
              type="file"
              accept=".wav,.mp3,.flac,.m4a,.ogg,.webm,audio/*"
              aria-label="Pilih berkas referensi"
              disabled={busy}
              onChange={(event) => void selectFile(event.target.files?.[0])}
            />
            <span className="upload-icon">
              {file ? <Check size={25} /> : <UploadCloud size={27} />}
            </span>
            <strong>
              {busy
                ? "Membaca rekaman…"
                : file
                  ? file.name
                  : "Pilih rekaman dari perangkat"}
            </strong>
            <span>
              {file
                ? `${formatTime(duration)} · ${(file.size / 1024 / 1024).toFixed(2)} MB`
                : "WAV, MP3, FLAC, M4A, OGG, WebM · maks. 20 MB"}
            </span>
          </label>
        )}
        {analysis && <AudioQualityPanel report={analysis} compact />}
        <label className="field-label">
          Nama suara
          <input
            autoComplete="off"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={60}
            placeholder="Contoh: Suara narasi saya"
            required
          />
        </label>
        <label className="field-label">
          Catatan <span className="optional">opsional</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={300}
            rows={3}
            placeholder="Karakter suara, gaya, atau catatan rekaman…"
          />
        </label>
        {!voice && <RecordingGuide />}
        {error && <ErrorMessage>{error}</ErrorMessage>}
        <div className="dialog-actions">
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Batal
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={busy || (!voice && analysis?.status === "fail")}
          >
            <Upload size={16} />
            {busy ? "Memproses…" : "Simpan referensi"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
