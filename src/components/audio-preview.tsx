"use client";

import { useEffect, useState } from "react";
import { readAudio } from "@/lib/audio-storage";

export function AudioPreview({ voiceId }: { voiceId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
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
  }, [voiceId]);
  if (error)
    return (
      <p className="small audio-error" role="alert">
        {error}
      </p>
    );
  if (!url)
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
        src={url}
        aria-label="Putar rekaman referensi"
      />
    </div>
  );
}
