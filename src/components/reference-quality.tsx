import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Mic2,
  XCircle,
} from "lucide-react";
import type {
  AudioQualityReport,
  AudioQualityStatus,
} from "@/lib/audio-analysis";

const statusCopy: Record<AudioQualityStatus, { label: string; detail: string }> = {
  pass: {
    label: "Siap diuji",
    detail: "Pemeriksaan teknis lokal lulus.",
  },
  warning: {
    label: "Perlu perhatian",
    detail: "Dapat disimpan, tetapi perbaikan berikut disarankan.",
  },
  fail: {
    label: "Belum layak",
    detail: "Perbaiki masalah bertanda gagal sebelum menyimpan.",
  },
};

function StatusIcon({ status }: { status: AudioQualityStatus }) {
  return status === "pass" ? (
    <CheckCircle2 size={16} />
  ) : status === "warning" ? (
    <AlertTriangle size={16} />
  ) : (
    <XCircle size={16} />
  );
}

function fixed(value: number, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : "–";
}

export function AudioQualityBadge({ report }: { report: AudioQualityReport }) {
  return (
    <span className={`quality-badge ${report.status}`}>
      <StatusIcon status={report.status} />
      {statusCopy[report.status].label}
    </span>
  );
}

export function AudioQualityPanel({
  report,
  compact = false,
}: {
  report: AudioQualityReport;
  compact?: boolean;
}) {
  return (
    <section
      className={`quality-panel ${report.status} ${compact ? "compact" : ""}`}
      aria-label="Hasil pemeriksaan kualitas rekaman"
    >
      <div className="quality-heading">
        <div>
          <StatusIcon status={report.status} />
          <strong>{statusCopy[report.status].label}</strong>
        </div>
        <span>{statusCopy[report.status].detail}</span>
      </div>
      <dl className="quality-metrics">
        <div>
          <dt>Format</dt>
          <dd>
            {report.format}
            {report.bitDepth ? ` ${report.bitDepth}-bit` : ""}
          </dd>
        </div>
        <div>
          <dt>Durasi</dt>
          <dd>{fixed(report.durationSeconds)} dtk</dd>
        </div>
        <div>
          <dt>Sample rate</dt>
          <dd>{(report.sampleRate / 1000).toFixed(1)} kHz</dd>
        </div>
        <div>
          <dt>Channel</dt>
          <dd>{report.channels === 1 ? "Mono" : `${report.channels} channel`}</dd>
        </div>
        <div>
          <dt>RMS</dt>
          <dd>{fixed(report.rmsDbfs)} dBFS</dd>
        </div>
        <div>
          <dt>Puncak</dt>
          <dd>{fixed(report.peakDbfs)} dBFS</dd>
        </div>
        <div>
          <dt>Clipping</dt>
          <dd>{fixed(report.clippingPercent, 3)}%</dd>
        </div>
        <div>
          <dt>Hening tepi</dt>
          <dd>
            {fixed(report.leadingSilenceSeconds)} / {fixed(report.trailingSilenceSeconds)} dtk
          </dd>
        </div>
      </dl>
      <ul className="quality-findings">
        {report.findings
          .filter((item) => !compact || item.status !== "pass")
          .map((item) => (
            <li className={item.status} key={item.code}>
              <StatusIcon status={item.status} />
              <span>
                <strong>{item.label}</strong>
                {item.message}
              </span>
            </li>
          ))}
      </ul>
      {compact && report.findings.every((item) => item.status === "pass") && (
        <p className="quality-all-pass">Semua tujuh pemeriksaan teknis lulus.</p>
      )}
    </section>
  );
}

export const REFERENCE_RECORDING_TEXT =
  "Hari ini saya merekam suara dengan jelas dan santai. Saya menjaga jarak dari mikrofon, berbicara dengan volume yang stabil, dan memberi jeda alami di antara kalimat. Harga produk ini seratus dua puluh sembilan ribu rupiah. Promo berlaku sampai tanggal dua puluh lima Desember. Jika kualitasnya sesuai kebutuhan, kita dapat melanjutkan ke tahap berikutnya dengan tenang dan percaya diri.";

export function RecordingGuide({ open = false }: { open?: boolean }) {
  return (
    <details className="recording-guide" open={open}>
      <summary>
        <Mic2 size={17} />
        <span>
          <strong>Panduan rekaman referensi</strong>
          <small>Target WAV PCM mono, 15–60 detik, tanpa musik.</small>
        </span>
      </summary>
      <div className="recording-guide-body">
        <ol>
          <li>Rekam di ruangan tenang dengan jarak mikrofon tetap sekitar 10–20 cm.</li>
          <li>Gunakan satu pembicara, volume stabil, artikulasi natural, dan tanpa musik atau efek.</li>
          <li>Hindari echo, kipas, sentuhan meja, noise reduction agresif, dan normalisasi sampai 0 dBFS.</li>
          <li>Ekspor WAV PCM mono minimal 24 kHz bila tersedia. MP3 tetap dapat diperiksa dengan peringatan.</li>
          <li>Untuk Hi-Fi, salin transkrip persis seperti ucapan, termasuk angka yang benar-benar dibaca.</li>
        </ol>
        <div className="recording-script">
          <div>
            <ClipboardCheck size={16} />
            <strong>Teks rekaman yang disarankan</strong>
          </div>
          <p>{REFERENCE_RECORDING_TEXT}</p>
        </div>
        <div className="guide-downloads">
          <a href="/quality/voice-quality-test-corpus.json" download>
            Unduh korpus 24 naskah
          </a>
          <a href="/quality/voice-quality-evaluation-template.csv" download>
            Unduh lembar penilaian
          </a>
        </div>
      </div>
    </details>
  );
}
