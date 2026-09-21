"use client";

import { useEffect, useState } from "react";
import { readAudio } from "@/lib/audio-storage";

export function AudioPreview({
  voiceId,
  audioUrl,
}: {
  voiceId: string;
  audioUrl?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (audioUrl) return;
    let disposed = false;
    let objectUrl: string | null = null;
    readAudio(voiceId)
      .then((blob) => {
        if (disposed) return;
        if (!blob) {
          setError(
            "Rekaman lokal tidak ditemukan. Tambahkan kembali referensi ini.",
          );
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!disposed) setError("Rekaman lokal tidak dapat dibuka.");
      });
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [voiceId, audioUrl]);
  if (!audioUrl && error)
    return (
      <p className="small audio-error" role="alert">
        {error}
      </p>
    );
  const source = audioUrl || url;
  if (!source)
    return (
      <p className="small muted" role="status">
        Memuat referensi…
      </p>
    );
  return (
    <div className="audio-preview">
      <span>Rekaman referensi asli · bukan hasil AI</span>
      <audio
        controls
        preload="metadata"
        src={source}
        aria-label="Putar rekaman referensi"
      />
    </div>
  );
}
