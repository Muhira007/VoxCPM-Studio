"use client";

import { ArrowRight, History, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { JOB_LABELS, modeLabel } from "@/lib/fixtures";
import { JobResult } from "./job-result";
import { useStudio } from "./studio-provider";
import { EmptyState, Modal } from "./ui";

export function HistoryPage() {
  const { state } = useStudio();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const router = useRouter();
  const jobs = state.jobs.filter(
    (job) =>
      (status === "all" || job.status === status) &&
      `${job.request.text} ${job.voiceName}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const selected = state.jobs.find((job) => job.id === selectedId);
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">JEJAK KREASIMU</div>
          <h1>
            Cerita yang pernah kamu mulai<span>.</span>
          </h1>
          <p>
            Temukan naskah, lihat proses, dan lanjutkan dari pekerjaan
            sebelumnya.
          </p>
        </div>
        <Link href="/" className="button">
          Kembali ke Studio <ArrowRight size={16} />
        </Link>
      </div>
      <div className="stat-row">
        <div className="stat-card">
          <span>Total pekerjaan demo</span>
          <strong>
            {state.jobs.length}
            <small>pekerjaan</small>
          </strong>
        </div>
        <div className="stat-card">
          <span>Simulasi selesai</span>
          <strong>
            {state.jobs.filter((job) => job.status === "succeeded").length}
            <small>pekerjaan</small>
          </strong>
        </div>
        <div className="stat-card">
          <span>Audio AI dihasilkan</span>
          <strong>
            0<small>Mode Demo</small>
          </strong>
        </div>
      </div>
      <div className="toolbar">
        <label className="search-field">
          <Search size={17} />
          <input
            aria-label="Cari riwayat"
            placeholder="Cari naskah atau suara…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label className="sr-only" htmlFor="job-filter">
          Filter status pekerjaan
        </label>
        <select
          id="job-filter"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="all">Semua status</option>
          {Object.entries(JOB_LABELS).map(([key, value]) => (
            <option key={key} value={key}>
              {value}
            </option>
          ))}
        </select>
      </div>
      <div className="panel">
        {jobs.length ? (
          <div className="table-scroll">
            <table className="history-table">
              <thead>
                <tr>
                  <th>Naskah & suara</th>
                  <th>Mode</th>
                  <th>Dibuat</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Aksi</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td>
                      <button
                        onClick={() => setSelectedId(job.id)}
                        className="history-title"
                      >
                        {job.request.text}
                      </button>
                      <span className="history-subtitle">
                        {job.voiceName} · {job.request.text.length} karakter
                      </span>
                    </td>
                    <td>{modeLabel(job.request.mode)}</td>
                    <td>
                      {new Date(job.createdAt).toLocaleString("id-ID", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td>
                      <span className={`job-badge ${job.status}`}>
                        {JOB_LABELS[job.status]}
                      </span>
                    </td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label={`Detail pekerjaan ${job.request.text.slice(0, 25)}`}
                        onClick={() => setSelectedId(job.id)}
                      >
                        <ArrowRight size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={<History size={30} />}
            title={
              state.jobs.length
                ? "Tidak ada pekerjaan yang cocok"
                : "Riwayatmu dimulai dari satu cerita"
            }
            description={
              state.jobs.length
                ? "Coba filter atau kata kunci lain."
                : "Jalankan simulasi pertama di Studio. Naskah dan status pekerjaanmu akan tersimpan di sini."
            }
          >
            {!state.jobs.length && (
              <Link href="/" className="button primary">
                Buka Studio <ArrowRight size={16} />
              </Link>
            )}
          </EmptyState>
        )}
      </div>
      <p className="bottom-note">
        Menyimpan hingga 100 pekerjaan terbaru di browser ini. Demo tidak
        menghasilkan berkas audio AI.
      </p>
      <Modal
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
        title="Detail pekerjaan"
        description={
          selected
            ? `${modeLabel(selected.request.mode)} · ${selected.voiceName}`
            : undefined
        }
      >
        {selected && (
          <>
            <div className="script-preview">{selected.request.text}</div>
            {selected.request.description && (
              <p className="info-note">
                Karakter: {selected.request.description}
              </p>
            )}
            <JobResult job={selected} onReuse={() => router.push("/")} />
          </>
        )}
      </Modal>
    </div>
  );
}
