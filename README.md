# VoxCPM Studio

Web UI pribadi berbahasa Indonesia untuk merancang alur TTS, Voice Design, dan voice cloning. **Frontend demo, API lokal, autentikasi sesi `HttpOnly`, adapter Web UI, worker simulasi, dan container simulasi telah diverifikasi. Paket worker VoxCPM2/CUDA sudah disiapkan, tetapi belum dijalankan pada GPU dan belum menghasilkan audio AI yang terverifikasi.**

## Menjalankan aplikasi

Gunakan Node.js 24 dan npm. Versi yang diuji: Node.js 24.17.0, npm 11.13.0. Tidak perlu API key, saldo RunPod, GPU, unduhan model, ataupun berkas `.env` untuk demo.

```powershell
cd D:\Project\tts-runpod
npm ci
npm run dev
```

Buka **http://127.0.0.1:3000**. Server hanya mendengarkan pada loopback lokal. Gunakan alamat yang sama setiap kali: penyimpanan browser `localhost` dan `127.0.0.1` terpisah.

Untuk menjalankan hasil build produksi lokal, hentikan development server dengan `Ctrl+C`, lalu:

```powershell
npm run build
npm start
```

Unduhan paket membutuhkan internet saat instalasi. Font dan ikon disertakan melalui dependensi lokal; proses demo dan rekaman referensi tidak memanggil layanan cloud.

Perintah di atas menjalankan frontend demo. Untuk memakai Web UI melalui API aplikasi dan worker FastAPI lokal, ikuti [panduan backend lokal](docs/backend-api.md). Mode tersebut memakai kata sandi studio, cookie sesi `HttpOnly`, dan dua kunci backend yang berbeda, tetapi tidak membutuhkan akun atau saldo RunPod.

## Fitur yang bisa dicoba

| Halaman | Perilaku saat ini |
| --- | --- |
| Studio | Editor 5.000 karakter, contoh naskah, empat mode, gaya bicara, pemilihan referensi, validasi, progres dan pembatalan demo. |
| Pustaka Suara | Tambah, cari, edit, hapus, dan putar rekaman referensi lokal. Tiga inspirasi karakter berisi deskripsi tanpa rekaman. |
| Riwayat | Hingga 100 pekerjaan terbaru, pencarian, filter status, detail, dan penggunaan ulang naskah. |
| Sesi GPU | Simulasi provisioning, pemuatan model, kesiapan, perpanjangan, dan penghentian sesi. Tarif hanya angka contoh. |
| Pengaturan | Durasi, idle timeout, batas harga contoh, skenario normal/gagal, serta reset data lokal. |

Urutan mencoba:

1. Buka Studio dan pilih TTS atau Voice Design; isi deskripsi jika memilih Voice Design.
2. Untuk cloning, tambahkan WAV/MP3/FLAC/M4A/OGG/WebM melalui Pustaka Suara, lalu pilih **Gunakan**. Maksimal 20 MB dan 5 menit; codec harus didukung browser. Hi-Fi memerlukan transkrip dan menonaktifkan gaya bicara.
3. Klik **Siapkan sesi demo**, tunggu **Model siap**, lalu **Jalankan simulasi**.
4. Lihat status di Hasil audio dan Riwayat. Status **Demo selesai** berarti alur simulasi selesai. Tombol unduh tetap nonaktif karena tidak ada audio hasil sintesis.
5. Di Pengaturan, ubah Skenario demo untuk mencoba GPU tidak tersedia, pemuatan lambat, sintesis gagal, atau koneksi terputus. Kembalikan ke Normal untuk mencoba lagi.
6. Akhiri sesi melalui Sesi GPU. Draft dan referensi tetap tersimpan.

## Penyimpanan dan batas demo

- Draft, preferensi, metadata referensi, serta riwayat tersimpan di `localStorage` dengan kunci `voxcpm-studio:v1`.
- Berkas referensi tersimpan di IndexedDB `voxcpm-audio-v1`, store `references`. Audio diputar melalui URL blob lokal.
- Refresh mengembalikan GPU ke nonaktif dan menandai pekerjaan yang belum selesai sebagai dibatalkan. Draft dan rekaman dipulihkan.
- Data hanya tersedia pada browser/origin/perangkat yang sama. Mode privat, penghapusan site data, kuota, atau penggusuran penyimpanan browser dapat menghapus data. Simpan berkas asli secara terpisah; gunakan satu tab untuk demo karena sinkronisasi antartab belum diterapkan.
- **Reset data lokal** menghapus seluruh data demo aplikasi di browser ini, termasuk berkas IndexedDB; berkas asli di perangkat tetap ada.
- Hanya satu pekerjaan aktif diizinkan. Klik berulang dilindungi di lapisan service.
- Idle timeout tidak menghentikan pekerjaan aktif. Tenggat sesi maksimum tetap dapat membatalkan pekerjaan. Total sesi dibatasi empat jam.
- Timer ini hanya simulasi di browser, **belum menjadi pengaman biaya cloud**. Tab latar belakang dapat menunda callback; tenggat diperiksa berdasarkan waktu saat callback berjalan kembali.
- `NEXT_PUBLIC_STUDIO_SERVICE=demo` memakai state browser. Nilai `api` menampilkan login dan memakai adapter API; hanya pilihan mode ini yang publik, sedangkan seluruh kunci dan secret tetap berada di server.
- Metadata backend tersimpan atomik di `.data/studio-state.json`; referensi dan output mempunyai direktori terpisah. Folder `.data` diabaikan Git dan perlu dipetakan ke volume persisten saat deployment.
- Mode API menyimpan draft di browser serta sesi, riwayat, pengaturan, dan referensi audio pada backend lokal. Logout menghapus cookie; reset backend memerlukan konfirmasi UI.
- Belum ada inferensi model, audio keluaran, konversi MP3, atau kontrol Pod sungguhan. Kemampuan dan kualitas suara VoxCPM2 masih harus diuji pada fase GPU.

## Pemeriksaan

```powershell
npm run typecheck
npm run lint
npm test
.\.venv\Scripts\python.exe -m pytest worker\tests -q
npm run build
```

Pengujian Node memakai `node:test`; pengujian worker memakai `pytest`. Keduanya tidak membutuhkan GPU atau koneksi RunPod. Selain frontend, pengujian mencakup persistensi server, pembatasan path, token dan origin sesi Web UI, adapter API, polling status, autentikasi worker, idempotensi, antrean tunggal, pembatalan, transfer referensi, pemetaan API VoxCPM2, penyimpanan WAV, dan kegagalan simulasi.

Integrasi browser ↔ Next.js ↔ FastAPI telah diuji lokal: login/logout cookie, origin guard, sesi worker, polling sampai selesai, unggah/baca/edit WAV, reset backend, serta tidak adanya audio keluaran palsu. Container simulasi kembali lulus pada [run 35568741418](https://github.com/Muhira007/VoxCPM-Studio/actions/runs/35568741418). Image GPU berhasil dibangun tanpa perangkat GPU pada [run 35568741429](https://github.com/Muhira007/VoxCPM-Studio/actions/runs/35568741429), termasuk verifikasi package, UID non-root, pin revision model, dan kegagalan yang jelas ketika CUDA tidak tersedia.

Image tervalidasi tersebut telah diterbitkan sebagai [paket GHCR publik](https://github.com/users/Muhira007/packages/container/package/voxcpm-studio-worker) melalui [run 35571278859](https://github.com/Muhira007/VoxCPM-Studio/actions/runs/35571278859). Gunakan referensi tetap `ghcr.io/muhira007/voxcpm-studio-worker@sha256:90ba964343f769a428259a59ac0acd8523de82c02f4ffddd82e2e8d78d715fbd`; jangan memakai tag `latest`. Tag commit dilindungi dari overwrite oleh workflow. Manifest tag dan digest telah diuji dengan pull anonim, tetapi image belum dijalankan pada GPU.

Persiapan Fase 5 memakai API key RunPod `Restricted` dengan akses baca saja. Key berada hanya di `.env.local` yang diabaikan Git; REST API v2 berhasil mengautentikasi dan mengembalikan inventaris kosong tanpa mutation. GraphQL tidak dipakai untuk client baru karena sudah dijadwalkan berhenti pada awal 2027. Demo tetap berjalan tanpa key atau akun RunPod.

Pemeriksaan UI manual mencakup desktop dan ponsel, input tidak valid, unggah WAV, pemutaran setelah refresh, cloning demo, pembatalan, riwayat, dan fokus dialog. Rincian hasil ada di [progress.md](progress.md).

## Struktur kode

```text
src/app/                  Route, layout, loading/error, dan gaya
src/components/           Halaman interaktif dan komponen bersama
src/lib/types.ts          Kontrak service dan tipe data
src/lib/demo-service.ts   State machine simulasi, validasi, persistensi metadata
src/lib/api-service.ts    Adapter browser untuk API lokal dan polling worker
src/lib/audio-storage.ts  Penyimpanan dan validasi audio di browser
src/lib/fixtures.ts       Naskah, inspirasi, profil GPU, dan label demo
src/lib/webmcp.ts         Peningkatan opsional untuk browser yang mendukung WebMCP
src/server/               Persistensi, validasi, autentikasi, dan client worker
src/app/api/v1/           Route Handler API aplikasi
worker/app/               Worker FastAPI mode simulasi dan adapter VoxCPM2
worker/Dockerfile.gpu     Image GPU RunPod dengan versi model/dependensi terkunci
worker/tests/             Pengujian kontrak worker
docs/                     API lokal, paket GPU, dan rancangan kontrol RunPod
tests/                    Pengujian frontend dan backend Node
.github/workflows/        Validasi otomatis image dan kontrak container
```

Halaman memakai kontrak `StudioService` melalui provider. Provider memilih adapter demo atau API berdasarkan konfigurasi publik non-rahasia; mode API memakai sesi `HttpOnly` dan tidak mengirim `STUDIO_API_KEY` ke browser. Gunakan [progress.md](progress.md) sebagai urutan pekerjaan dan catatan keputusan; paket image ada di [docs/gpu-worker-package.md](docs/gpu-worker-package.md), sedangkan rancangan shutdown cloud ada di [docs/runpod-worker-design.md](docs/runpod-worker-design.md).

WebMCP dideteksi secara opsional melalui `document.modelContext`. Jika tersedia, dua alat membaca status demo dan mengganti draft memakai state yang sama dengan UI. Pendaftaran dibersihkan dengan `AbortSignal`; browser tanpa dukungan tetap dapat memakai seluruh UI. Verifikasi dalam konteks WebMCP yang mendukung belum dilakukan; fitur ini bukan prasyarat demo lokal.

Stack: Next.js App Router, React, TypeScript, Tailwind CSS, Radix Dialog, Lucide, Geist lokal, FastAPI, Pydantic, dan Uvicorn. Versi Node dikunci di `package-lock.json`; dependensi worker dikunci di `worker/requirements*.txt`. Baca panduan Next.js yang ikut terpasang di `node_modules/next/dist/docs/` sebelum perubahan terkait framework.
