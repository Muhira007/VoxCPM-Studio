import type {
  AppSettings,
  SynthesisMode,
  StylePreset,
  SynthesisRequest,
  Voice,
} from "./types";

export const MODES: {
  id: SynthesisMode;
  label: string;
  short: string;
  description: string;
}[] = [
  {
    id: "tts",
    label: "Text to Speech",
    short: "TTS",
    description: "Ubah naskah menjadi tuturan dengan suara bawaan.",
  },
  {
    id: "design",
    label: "Voice Design",
    short: "Voice Design",
    description: "Bentuk karakter suara melalui deskripsi.",
  },
  {
    id: "clone",
    label: "Cloning dengan Gaya",
    short: "Voice Cloning",
    description: "Gunakan referensi suara dan arahkan gaya bicaranya.",
  },
  {
    id: "hifi",
    label: "Hi-Fi Cloning",
    short: "Hi-Fi",
    description: "Pertahankan karakter referensi dengan transkrip yang sesuai.",
  },
];
export const STYLES: { id: StylePreset; label: string; description: string }[] =
  [
    {
      id: "natural",
      label: "Natural",
      description: "Mengalir, seperti percakapan sehari-hari",
    },
    {
      id: "calm",
      label: "Tenang",
      description: "Lembut, hangat, dan tidak terburu-buru",
    },
    {
      id: "cheerful",
      label: "Ceria",
      description: "Ringan dan penuh semangat",
    },
    {
      id: "dramatic",
      label: "Dramatis",
      description: "Bercerita dengan penekanan yang kuat",
    },
  ];
export const EXAMPLE_TEXT =
  "Setiap cerita punya suaranya sendiri.\n\nAda yang dimulai dengan bisikan, ada yang hadir penuh semangat. Apa pun ceritamu, berikan ruang untuk didengar.\n\nMari mulai sesuatu yang berarti, satu kalimat pada satu waktu.";
export const EXAMPLE_VOICES: Voice[] = [
  {
    id: "example-narator",
    name: "Narator Hangat",
    description: "Hangat · Jelas · Bercerita",
    source: "example",
    color: "orange",
    createdAt: 0,
  },
  {
    id: "example-senja",
    name: "Senja",
    description: "Lembut · Tenang · Reflektif",
    source: "example",
    color: "purple",
    createdAt: 0,
  },
  {
    id: "example-aksara",
    name: "Aksara",
    description: "Tegas · Natural · Informatif",
    source: "example",
    color: "blue",
    createdAt: 0,
  },
];
export const GPU_PROFILES = [
  {
    id: "a5000",
    name: "RTX A5000",
    memory: "24 GB",
    rate: 0.27,
    detail: "Profil hemat",
  },
  {
    id: "3090",
    name: "RTX 3090",
    memory: "24 GB",
    rate: 0.5,
    detail: "Profil seimbang",
  },
  {
    id: "4090",
    name: "RTX 4090",
    memory: "24 GB",
    rate: 0.74,
    detail: "Profil cepat",
  },
];
export const DEFAULT_SETTINGS: AppSettings = {
  sessionMinutes: 60,
  idleMinutes: 10,
  maxHourlyRate: 0.8,
  gpuId: "a5000",
  scenario: "normal",
};
export const DEFAULT_DRAFT: SynthesisRequest = {
  text: EXAMPLE_TEXT,
  mode: "tts",
  voiceId: "example-narator",
  description: "",
  transcript: "",
  style: "natural",
};

export function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}
export function modeLabel(mode: SynthesisMode) {
  return MODES.find((item) => item.id === mode)?.label ?? mode;
}
export const GPU_LABELS = {
  off: "GPU nonaktif",
  provisioning: "Menyiapkan GPU",
  loading: "Memuat model",
  ready: "Model siap",
  stopping: "Mengakhiri sesi",
  error: "Sesi bermasalah",
};
export const JOB_LABELS = {
  queued: "Dalam antrean",
  running: "Diproses",
  succeeded: "Demo selesai",
  failed: "Gagal",
  cancelled: "Dibatalkan",
};
