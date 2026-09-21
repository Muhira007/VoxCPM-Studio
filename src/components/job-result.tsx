"use client";

import {
  AudioLines,
  Check,
  CircleAlert,
  Download,
  LoaderCircle,
  RotateCcw,
  X,
} from "lucide-react";
import { JOB_LABELS, modeLabel } from "@/lib/fixtures";
import type { SynthesisJob } from "@/lib/types";
import { useStudio } from "./studio-provider";
import { useToast } from "./ui";

export function JobResult({
  job,
  onReuse,
}: {
  job: SynthesisJob;
  onReuse?: () => void;
}) {
  const { service } = useStudio();
  const toast = useToast();
  const busy = job.status === "queued" || job.status === "running";
  return (
    <div className="job-result">
      <div className={`job-icon ${job.status}`}>
        {busy ? (
          <LoaderCircle className="spin" size={22} />
        ) : job.status === "succeeded" ? (
          <Check size={23} />
        ) : job.status === "failed" ? (
          <CircleAlert size={23} />
        ) : (
          <X size={23} />
        )}
      </div>
      <div className="job-body">
        <div className="job-title">
          <strong>{JOB_LABELS[job.status]}</strong>
          <span className="tag">{modeLabel(job.request.mode)}</span>
        </div>
        <p>
          {busy
            ? "Memeriksa naskah dan mensimulasikan proses sintesis…"
            : job.message}
        </p>
        {busy && (
          <div
            className="progress-track"
            role="progressbar"
            aria-label="Progres pekerjaan demo"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={job.progress}
          >
            <span style={{ width: `${Math.max(5, job.progress)}%` }} />
          </div>
        )}
        {job.audioUrl && (
          <audio
            controls
            src={job.audioUrl}
            aria-label="Putar hasil sintesis"
          />
        )}
        <div className="job-meta">
          <AudioLines size={13} />
          <span>{job.voiceName}</span>
          <span>·</span>
          <span>{job.request.text.length} karakter</span>
          {job.audioDuration !== null && (
            <span>· {job.audioDuration} detik</span>
          )}
        </div>
      </div>
      <div className="job-actions">
        {busy ? (
          <button
            className="button small-button"
            onClick={() => {
              void Promise.resolve(service.cancelJob(job.id)).catch((error) =>
                toast(
                  error instanceof Error
                    ? error.message
                    : "Pekerjaan gagal dibatalkan.",
                ),
              );
            }}
          >
            Batalkan
          </button>
        ) : (
          <>
            <button
              className="icon-button"
              aria-label="Gunakan ulang naskah"
              title="Gunakan ulang naskah"
              onClick={() => {
                service.updateDraft(job.request);
                toast("Naskah dan pengaturan dikembalikan ke Studio.");
                onReuse?.();
              }}
            >
              <RotateCcw size={17} />
            </button>
            {job.audioUrl ? (
              <a
                className="icon-button"
                aria-label="Unduh hasil audio"
                href={job.audioUrl}
                download
              >
                <Download size={17} />
              </a>
            ) : (
              <button
                className="icon-button"
                aria-label="Unduh audio belum tersedia pada demo"
                title="Demo belum menghasilkan audio"
                disabled
              >
                <Download size={17} />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
