export const AUDIO_ANALYSIS_VERSION = 1 as const;
export const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
export const MAX_REFERENCE_SECONDS = 300;

export type AudioQualityStatus = "pass" | "warning" | "fail";

export interface AudioQualityFinding {
  code:
    | "format"
    | "duration"
    | "sample-rate"
    | "channels"
    | "level"
    | "clipping"
    | "edge-silence";
  status: AudioQualityStatus;
  label: string;
  message: string;
}

export interface AudioQualityReport {
  version: typeof AUDIO_ANALYSIS_VERSION;
  format: string;
  durationSeconds: number;
  sampleRate: number;
  channels: number;
  bitDepth: number | null;
  peakDbfs: number;
  rmsDbfs: number;
  clippingPercent: number;
  leadingSilenceSeconds: number;
  trailingSilenceSeconds: number;
  status: AudioQualityStatus;
  findings: AudioQualityFinding[];
  analyzedAt: number;
}

export interface PcmAudioInput {
  channelData: readonly Float32Array[];
  sampleRate: number;
  format: string;
  bitDepth?: number | null;
  analyzedAt?: number;
}

const allowedExtension = /\.(wav|mp3|flac|m4a|ogg|webm)$/i;
const silenceAmplitude = 10 ** (-45 / 20);

function dbfs(amplitude: number) {
  return amplitude > 0 ? Math.max(-120, 20 * Math.log10(amplitude)) : -120;
}

function finding(
  code: AudioQualityFinding["code"],
  status: AudioQualityStatus,
  label: string,
  message: string,
): AudioQualityFinding {
  return { code, status, label, message };
}

function overallStatus(findings: readonly AudioQualityFinding[]): AudioQualityStatus {
  if (findings.some((item) => item.status === "fail")) return "fail";
  if (findings.some((item) => item.status === "warning")) return "warning";
  return "pass";
}

export function analyzePcmAudio(input: PcmAudioInput): AudioQualityReport {
  if (!Number.isFinite(input.sampleRate) || input.sampleRate <= 0)
    throw new Error("Sample rate audio tidak valid.");
  if (!input.channelData.length || input.channelData.length > 8)
    throw new Error("Jumlah channel audio tidak valid.");
  const frameCount = Math.min(...input.channelData.map((channel) => channel.length));
  if (!frameCount) throw new Error("Audio tidak memiliki sampel yang dapat dianalisis.");

  let peak = 0;
  let sumSquares = 0;
  let clipped = 0;
  let leadingSilentFrames = 0;
  let trailingSilentFrames = 0;
  let leading = true;

  for (let frame = 0; frame < frameCount; frame += 1) {
    let framePeak = 0;
    for (const channel of input.channelData) {
      const sample = Math.abs(channel[frame] ?? 0);
      peak = Math.max(peak, sample);
      framePeak = Math.max(framePeak, sample);
      sumSquares += sample * sample;
      if (sample >= 0.999) clipped += 1;
    }
    if (leading && framePeak < silenceAmplitude) leadingSilentFrames += 1;
    else leading = false;
  }
  for (let frame = frameCount - 1; frame >= 0; frame -= 1) {
    let framePeak = 0;
    for (const channel of input.channelData)
      framePeak = Math.max(framePeak, Math.abs(channel[frame] ?? 0));
    if (framePeak >= silenceAmplitude) break;
    trailingSilentFrames += 1;
  }

  const channels = input.channelData.length;
  const durationSeconds = frameCount / input.sampleRate;
  const rms = Math.sqrt(sumSquares / (frameCount * channels));
  const peakDbfs = dbfs(peak);
  const rmsDbfs = dbfs(rms);
  const clippingPercent = (clipped / (frameCount * channels)) * 100;
  const leadingSilenceSeconds = leadingSilentFrames / input.sampleRate;
  const trailingSilenceSeconds = trailingSilentFrames / input.sampleRate;
  const format = input.format.replace(/^\./, "").toUpperCase();
  const findings: AudioQualityFinding[] = [];

  findings.push(
    format === "WAV"
      ? finding("format", "pass", "Format", "WAV cocok untuk referensi tanpa kompresi lossy.")
      : finding(
          "format",
          "warning",
          "Format",
          `${format} dapat dipakai, tetapi WAV PCM lebih aman untuk menjaga detail suara.`,
        ),
  );
  findings.push(
    durationSeconds < 5 || durationSeconds > 120
      ? finding(
          "duration",
          "fail",
          "Durasi",
          "Gunakan bagian suara bersih sepanjang 15–60 detik; batas kesiapan adalah 5–120 detik.",
        )
      : durationSeconds < 15 || durationSeconds > 60
        ? finding(
            "duration",
            "warning",
            "Durasi",
            "Audio dapat disimpan, tetapi potongan 15–60 detik lebih efisien untuk pengujian cloning.",
          )
        : finding("duration", "pass", "Durasi", "Durasi berada dalam target 15–60 detik."),
  );
  findings.push(
    input.sampleRate < 16_000
      ? finding("sample-rate", "fail", "Sample rate", "Gunakan sample rate minimal 16 kHz.")
      : input.sampleRate < 24_000
        ? finding(
            "sample-rate",
            "warning",
            "Sample rate",
            "Sample rate dapat dipakai, tetapi 24 kHz atau lebih disarankan.",
          )
        : finding("sample-rate", "pass", "Sample rate", "Sample rate cukup untuk referensi suara."),
  );
  findings.push(
    channels > 2
      ? finding("channels", "fail", "Channel", "Gunakan audio mono atau stereo.")
      : channels === 2
        ? finding(
            "channels",
            "warning",
            "Channel",
            "Stereo dapat dipakai, tetapi mono menghindari perbedaan antarkanal yang tidak perlu.",
          )
        : finding("channels", "pass", "Channel", "Mono sesuai untuk referensi voice cloning."),
  );
  findings.push(
    rmsDbfs < -35
      ? finding("level", "fail", "Level suara", "Rekaman terlalu pelan; dekatkan mikrofon atau naikkan gain.")
      : rmsDbfs < -28 || rmsDbfs > -10
        ? finding(
            "level",
            "warning",
            "Level suara",
            rmsDbfs < -28
              ? "Level agak pelan. Usahakan suara utama berada sekitar −28 sampai −10 dBFS RMS."
              : "Level rata-rata terlalu panas. Turunkan gain agar tersedia ruang untuk puncak.",
          )
        : finding("level", "pass", "Level suara", "Level rata-rata berada dalam rentang kerja lokal."),
  );
  findings.push(
    clippingPercent >= 0.1 || peakDbfs > -0.1
      ? finding("clipping", "fail", "Clipping", "Puncak menyentuh batas digital; rekam ulang dengan gain lebih rendah.")
      : clippingPercent > 0.01 || peakDbfs > -1
        ? finding(
            "clipping",
            "warning",
            "Clipping",
            "Puncak terlalu dekat 0 dBFS. Sisakan headroom dengan menurunkan gain rekaman.",
          )
        : peakDbfs < -12
          ? finding("clipping", "warning", "Puncak", "Puncak cukup rendah; periksa jarak mikrofon dan gain.")
          : finding("clipping", "pass", "Clipping", "Tidak ditemukan clipping yang berarti."),
  );
  const longestEdgeSilence = Math.max(leadingSilenceSeconds, trailingSilenceSeconds);
  findings.push(
    longestEdgeSilence > 5
      ? finding("edge-silence", "fail", "Keheningan tepi", "Potong keheningan lebih dari 5 detik di awal atau akhir.")
      : longestEdgeSilence > 2
        ? finding("edge-silence", "warning", "Keheningan tepi", "Potong keheningan awal/akhir menjadi maksimal 2 detik.")
        : finding("edge-silence", "pass", "Keheningan tepi", "Awal dan akhir rekaman cukup rapat."),
  );

  return {
    version: AUDIO_ANALYSIS_VERSION,
    format,
    durationSeconds,
    sampleRate: input.sampleRate,
    channels,
    bitDepth: input.bitDepth ?? null,
    peakDbfs,
    rmsDbfs,
    clippingPercent,
    leadingSilenceSeconds,
    trailingSilenceSeconds,
    status: overallStatus(findings),
    findings,
    analyzedAt: input.analyzedAt ?? Date.now(),
  };
}

function wavBitDepth(buffer: ArrayBuffer): number | null {
  if (buffer.byteLength < 44) return null;
  const view = new DataView(buffer);
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...new Uint8Array(buffer, offset, length));
  if (ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WAVE") return null;
  let offset = 12;
  while (offset + 8 <= buffer.byteLength) {
    const chunk = ascii(offset, 4);
    const size = view.getUint32(offset + 4, true);
    if (chunk === "fmt " && size >= 16 && offset + 8 + size <= buffer.byteLength)
      return view.getUint16(offset + 8 + 14, true);
    offset += 8 + size + (size % 2);
  }
  return null;
}

export async function inspectReferenceAudio(file: File): Promise<AudioQualityReport> {
  if (!allowedExtension.test(file.name))
    throw new Error("Gunakan berkas WAV, MP3, FLAC, M4A, OGG, atau WebM.");
  if (!file.size || file.size > MAX_REFERENCE_BYTES)
    throw new Error("Ukuran berkas harus lebih dari 0 dan maksimal 20 MB.");
  const extension = file.name.split(".").at(-1)?.toUpperCase() ?? "AUDIO";
  const bytes = await file.arrayBuffer();
  const contextClass = (
    globalThis as typeof globalThis & {
      webkitAudioContext?: typeof AudioContext;
    }
  ).AudioContext ??
    (globalThis as typeof globalThis & {
      webkitAudioContext?: typeof AudioContext;
    }).webkitAudioContext;
  if (!contextClass)
    throw new Error("Browser ini tidak menyediakan decoder audio untuk pemeriksaan kualitas.");
  const context = new contextClass();
  try {
    const decoded = await context.decodeAudioData(bytes.slice(0));
    if (!Number.isFinite(decoded.duration) || decoded.duration <= 0 || decoded.duration > MAX_REFERENCE_SECONDS)
      throw new Error("Pilih audio dengan durasi valid, maksimal 5 menit.");
    return analyzePcmAudio({
      channelData: Array.from({ length: decoded.numberOfChannels }, (_, index) =>
        decoded.getChannelData(index),
      ),
      sampleRate: decoded.sampleRate,
      format: extension,
      bitDepth: extension === "WAV" ? wavBitDepth(bytes) : null,
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Pilih audio")) throw error;
    throw new Error("Audio tidak dapat didekode untuk pemeriksaan. Coba ekspor sebagai WAV PCM.");
  } finally {
    await context.close().catch(() => undefined);
  }
}

export function isAudioQualityReport(value: unknown): value is AudioQualityReport {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const report = value as Record<string, unknown>;
  const finite = (key: string) => typeof report[key] === "number" && Number.isFinite(report[key]);
  const findings = Array.isArray(report.findings) ? report.findings : [];
  const findingRecords = findings.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item),
  );
  const codes = findingRecords.map((item) => String(item.code));
  const findingStatuses = findingRecords.map((item) => String(item.status));
  const derivedStatus = findingStatuses.includes("fail")
    ? "fail"
    : findingStatuses.includes("warning")
      ? "warning"
      : "pass";
  return (
    report.version === AUDIO_ANALYSIS_VERSION &&
    typeof report.format === "string" &&
    report.format.length >= 2 &&
    report.format.length <= 8 &&
    finite("durationSeconds") &&
    Number(report.durationSeconds) > 0 &&
    Number(report.durationSeconds) <= MAX_REFERENCE_SECONDS &&
    finite("sampleRate") &&
    Number.isInteger(report.sampleRate) &&
    Number(report.sampleRate) >= 8_000 &&
    Number(report.sampleRate) <= 384_000 &&
    finite("channels") &&
    Number.isInteger(report.channels) &&
    Number(report.channels) >= 1 &&
    Number(report.channels) <= 8 &&
    (report.bitDepth === null || finite("bitDepth")) &&
    finite("peakDbfs") &&
    finite("rmsDbfs") &&
    finite("clippingPercent") &&
    Number(report.clippingPercent) >= 0 &&
    Number(report.clippingPercent) <= 100 &&
    finite("leadingSilenceSeconds") &&
    Number(report.leadingSilenceSeconds) >= 0 &&
    Number(report.leadingSilenceSeconds) <= Number(report.durationSeconds) &&
    finite("trailingSilenceSeconds") &&
    Number(report.trailingSilenceSeconds) >= 0 &&
    Number(report.trailingSilenceSeconds) <= Number(report.durationSeconds) &&
    ["pass", "warning", "fail"].includes(String(report.status)) &&
    report.status === derivedStatus &&
    findings.length === 7 &&
    new Set(codes).size === 7 &&
    ["format", "duration", "sample-rate", "channels", "level", "clipping", "edge-silence"].every(
      (code) => codes.includes(code),
    ) &&
    findingRecords.length === 7 &&
    findingRecords.every(
      (item) =>
        ["pass", "warning", "fail"].includes(String(item.status)) &&
        typeof item.code === "string" &&
        typeof item.label === "string" &&
        item.label.length <= 100 &&
        typeof item.message === "string" &&
        item.message.length <= 500,
    ) &&
    finite("analyzedAt") &&
    Number(report.analyzedAt) > 0
  );
}
