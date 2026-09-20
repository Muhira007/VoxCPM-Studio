# Backend lokal Fase 4

Backend terdiri dari dua proses yang sengaja dipisah:

1. Next.js pada `127.0.0.1:3000` menyimpan sesi, pengaturan, pekerjaan, metadata suara, referensi, dan hasil. Route Handler berada di `/api/v1/*`.
2. FastAPI pada `127.0.0.1:8001` menjalankan kontrak worker. Mode saat ini selalu `simulation`: VoxCPM2 tidak dimuat dan tidak ada audio hasil yang dibuat.

Kunci worker hanya dibaca oleh Next.js dan FastAPI. `STUDIO_API_KEY` dipakai untuk pengujian API tepercaya dari terminal. Web UI Fase 1–3 masih memakai service demo di browser dan tidak menerima kedua kunci ini. Integrasi UI berikutnya harus memakai sesi pengguna `HttpOnly` atau mekanisme autentikasi server; jangan mengirim kunci tersebut ke JavaScript browser.

## Menyiapkan lingkungan Windows

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --requirement worker\requirements-dev.txt

$studioKey = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLower()
$workerKey = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLower()
Copy-Item .env.example .env.local
```

Edit `.env.local`: ganti placeholder `STUDIO_API_KEY` dan `WORKER_API_KEY` dengan dua nilai berbeda di atas. Berkas tersebut diabaikan Git. Jangan memakai awalan `NEXT_PUBLIC_`.

Pada terminal pertama:

```powershell
$env:WORKER_API_KEY = $workerKey
$env:WORKER_DATA_DIR = "D:\Project\tts-runpod\.data\worker"
$env:WORKER_REFERENCES_DIR = "D:\Project\tts-runpod\.data\references"
$env:WORKER_OUTPUTS_DIR = "D:\Project\tts-runpod\.data\outputs"
.\.venv\Scripts\python.exe worker\start.py
```

Pada terminal kedua, jalankan `npm run dev`. Next.js memuat `.env.local` dari root proyek.

Worker memeriksa bahwa direktori data, model, cache, referensi, dan output dapat ditulis sebelum menerima permintaan. Untuk pengujian Docker, mount semua direktori `/workspace/*` ke storage persisten; jangan menyimpan hasil penting hanya di filesystem container.

## Kontrak API aplikasi

Semua endpoint selain health memerlukan header `X-Studio-Key`.

| Method | Endpoint | Fungsi |
| --- | --- | --- |
| `GET` | `/api/v1/health` | Status API, konfigurasi, dan kemampuan menulis storage. |
| `GET/POST/DELETE` | `/api/v1/sessions` | Baca, mulai, atau hentikan sesi worker lokal. |
| `POST` | `/api/v1/sessions/extend` | Tambah 30 menit, maksimum empat jam sejak mulai. |
| `GET/POST` | `/api/v1/jobs` | Daftar pekerjaan atau buat pekerjaan idempoten. |
| `GET` | `/api/v1/jobs/{id}` | Poll status terbaru dari worker. |
| `POST` | `/api/v1/jobs/{id}/cancel` | Batalkan pekerjaan aktif. |
| `GET/POST` | `/api/v1/voices` | Daftar metadata atau unggah referensi maksimal 20 MB. |
| `GET` | `/api/v1/voices/{id}/audio` | Baca kembali referensi dengan `nosniff` dan tanpa cache. |
| `DELETE` | `/api/v1/voices/{id}` | Hapus metadata serta berkas referensi. |
| `GET/PUT` | `/api/v1/settings` | Baca atau simpan rancangan durasi, idle, harga, dan profil GPU. |

`POST /api/v1/jobs` memerlukan `Idempotency-Key` sepanjang 8–100 karakter. Kunci sama dengan isi sama mengembalikan pekerjaan yang sama; isi berbeda menghasilkan `409`. Worker MVP menolak pekerjaan paralel.

Body pekerjaan mengikuti `SynthesisRequest` frontend:

```json
{
  "text": "Selamat datang di pengujian lokal.",
  "mode": "tts",
  "voiceId": "",
  "description": "",
  "transcript": "",
  "style": "natural"
}
```

Header `X-Demo-Scenario: failure|slow` hanya tersedia untuk uji worker simulasi. Respons sukses simulasi selalu memiliki `outputFile: null` dan `audioDuration: null`.

## Kontrak worker

`GET /health` adalah liveness publik dan tidak menyatakan model siap. Endpoint berikut memakai `X-Worker-Key`:

- `GET /v1/ready`
- `POST /v1/jobs`
- `GET /v1/jobs/{id}`
- `POST /v1/jobs/{id}/cancel`

Worker memvalidasi mode, batas teks, deskripsi Voice Design, referensi cloning, transkrip Hi-Fi, serta pembatasan gaya Hi-Fi. `reference_path` wajib menunjuk berkas yang benar-benar berada di `WORKER_REFERENCES_DIR`. Pekerjaan aktif saat worker restart ditandai gagal agar tidak terlihat terus berjalan.

## Docker

Image belum dapat dibangun di mesin pengembangan saat ini karena Docker tidak terpasang. Dockerfile memakai Python `3.12.11-slim-bookworm`, dependensi terkunci, user non-root, dan health check:

```powershell
docker build --file worker/Dockerfile --tag voxcpm-worker:simulation worker
docker run --rm --publish 8001:8001 `
  --env WORKER_API_KEY=$workerKey `
  --volume "${PWD}\.data:/workspace" `
  voxcpm-worker:simulation
```

Container ini hanya memvalidasi kontrak simulasi. Dependensi VoxCPM2/CUDA dan inferensi GPU ditambahkan setelah versi upstream serta image RunPod dipilih dan diuji.
