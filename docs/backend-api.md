# Backend lokal Fase 4

Backend terdiri dari dua proses yang sengaja dipisah:

1. Next.js pada `127.0.0.1:3000` menyimpan sesi, pengaturan, pekerjaan, metadata suara, referensi, dan hasil. Route Handler berada di `/api/v1/*`.
2. FastAPI pada `127.0.0.1:8001` menjalankan kontrak worker. Mode saat ini selalu `simulation`: VoxCPM2 tidak dimuat dan tidak ada audio hasil yang dibuat.

Kunci worker hanya dibaca oleh Next.js dan FastAPI. `STUDIO_API_KEY` dipakai untuk klien tepercaya seperti pengujian terminal. Web UI memakai kata sandi terpisah untuk memperoleh cookie sesi `HttpOnly`; `STUDIO_API_KEY`, `WORKER_API_KEY`, dan `STUDIO_SESSION_SECRET` tidak pernah dikirim ke JavaScript browser.

## Menyiapkan lingkungan Windows

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --requirement worker\requirements-dev.txt

$studioKey = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLower()
$workerKey = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLower()
$sessionSecret = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLower()
$accessPassword = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(18))
Copy-Item .env.example .env.local
```

Edit `.env.local`: ganti empat placeholder dengan `$studioKey`, `$workerKey`, `$sessionSecret`, dan `$accessPassword`, lalu ubah `NEXT_PUBLIC_STUDIO_SERVICE=api`. Berkas tersebut diabaikan Git. Hanya pemilihan adapter yang memakai awalan `NEXT_PUBLIC_`; jangan memakai awalan tersebut untuk kunci, password, atau session secret.

Pada terminal pertama:

```powershell
$env:WORKER_API_KEY = $workerKey
$env:WORKER_DATA_DIR = "D:\Project\tts-runpod\.data\worker"
$env:WORKER_REFERENCES_DIR = "D:\Project\tts-runpod\.data\references"
$env:WORKER_OUTPUTS_DIR = "D:\Project\tts-runpod\.data\outputs"
.\.venv\Scripts\python.exe worker\start.py
```

Pada terminal kedua, jalankan `npm run dev`. Next.js memuat `.env.local` dari root proyek. Buka `http://127.0.0.1:3000`, lalu masuk menggunakan nilai `$accessPassword`. Untuk build produksi, nilai `NEXT_PUBLIC_STUDIO_SERVICE` harus sudah tersedia saat menjalankan `npm run build`.

Worker memeriksa bahwa direktori data, model, cache, referensi, dan output dapat ditulis sebelum menerima permintaan. Untuk pengujian Docker, mount semua direktori `/workspace/*` ke storage persisten; jangan menyimpan hasil penting hanya di filesystem container.

## Kontrak API aplikasi

Endpoint data menerima header `X-Studio-Key` untuk klien tepercaya atau cookie sesi Web UI yang valid. Mutasi berbasis cookie juga harus berasal dari origin aplikasi yang sama. Header kunci tetap dapat digunakan oleh pengujian terminal tanpa cookie.

| Method | Endpoint | Fungsi |
| --- | --- | --- |
| `GET` | `/api/v1/health` | Status API, konfigurasi, dan kemampuan menulis storage. |
| `GET` | `/api/v1/auth/session` | Status konfigurasi dan sesi Web UI tanpa membuka isi cookie. |
| `POST` | `/api/v1/auth/login` | Verifikasi kata sandi dan buat cookie `HttpOnly`, `SameSite=Strict` selama 12 jam. |
| `POST` | `/api/v1/auth/logout` | Hapus cookie sesi Web UI. |
| `GET/POST/DELETE` | `/api/v1/sessions` | Baca, mulai, atau hentikan sesi worker lokal. |
| `POST` | `/api/v1/sessions/extend` | Tambah 30 menit, maksimum empat jam sejak mulai. |
| `GET/POST` | `/api/v1/jobs` | Daftar pekerjaan atau buat pekerjaan idempoten. |
| `GET` | `/api/v1/jobs/{id}` | Poll status terbaru dari worker. |
| `POST` | `/api/v1/jobs/{id}/cancel` | Batalkan pekerjaan aktif. |
| `GET/POST` | `/api/v1/voices` | Daftar metadata atau unggah referensi maksimal 20 MB. |
| `GET` | `/api/v1/voices/{id}/audio` | Baca kembali referensi dengan `nosniff` dan tanpa cache. |
| `PUT/DELETE` | `/api/v1/voices/{id}` | Edit metadata atau hapus metadata serta berkas referensi. |
| `GET/PUT` | `/api/v1/settings` | Baca atau simpan rancangan durasi, idle, harga, dan profil GPU. |
| `DELETE` | `/api/v1/data` | Hentikan sesi dan reset pekerjaan, referensi, serta pengaturan backend lokal. |

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

Login dibatasi lima kegagalan per sumber selama lima menit. Mengganti `STUDIO_SESSION_SECRET` membatalkan seluruh cookie yang lama. Gunakan HTTPS saat aplikasi diakses melalui jaringan; atribut `Secure` aktif untuk permintaan HTTPS. Mode default tetap `demo`, sehingga aplikasi dapat dibuka tanpa konfigurasi backend.

## Kontrak worker

`GET /health` adalah liveness publik dan tidak menyatakan model siap. Endpoint berikut memakai `X-Worker-Key`:

- `GET /v1/ready`
- `POST /v1/jobs`
- `GET /v1/jobs/{id}`
- `POST /v1/jobs/{id}/cancel`

Worker memvalidasi mode, batas teks, deskripsi Voice Design, referensi cloning, transkrip Hi-Fi, serta pembatasan gaya Hi-Fi. `reference_path` wajib menunjuk berkas yang benar-benar berada di `WORKER_REFERENCES_DIR`. Pekerjaan aktif saat worker restart ditandai gagal agar tidak terlihat terus berjalan.

## Docker

Docker tidak terpasang pada mesin pengembangan, tetapi image telah berhasil dibangun dan diuji pada [GitHub Actions run 35540568742](https://github.com/Muhira007/VoxCPM-Studio/actions/runs/35540568742). Pemeriksaan otomatis mencakup user non-root, liveness, autentikasi, readiness, pekerjaan simulasi tanpa audio, persistensi setelah restart, dan Docker health check. Dockerfile memakai Python `3.12.11-slim-bookworm` serta dependensi terkunci:

```powershell
docker build --file worker/Dockerfile --tag voxcpm-worker:simulation worker
docker run --rm --publish 8001:8001 `
  --env WORKER_API_KEY=$workerKey `
  --volume "${PWD}\.data:/workspace" `
  voxcpm-worker:simulation
```

Container ini hanya memvalidasi kontrak simulasi. Dependensi VoxCPM2/CUDA dan inferensi GPU ditambahkan setelah versi upstream serta image RunPod dipilih dan diuji.
