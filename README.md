# VoxCPM Studio

Web UI pribadi berbahasa Indonesia untuk merancang alur TTS, Voice Design, dan voice cloning. **Web UI Fase 1–3 serta API/worker simulasi Fase 4 berjalan lokal. Belum terhubung ke VoxCPM2 atau RunPod dan belum menghasilkan audio AI.**

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

Perintah di atas hanya membutuhkan frontend demo. Untuk menjalankan API aplikasi dan worker FastAPI lokal, ikuti [panduan backend Fase 4](docs/backend-api.md). Kedua proses membutuhkan dua kunci lokal yang berbeda, tetapi tidak membutuhkan akun atau saldo RunPod.

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
- Route Handler aplikasi dan worker FastAPI sudah tersedia sebagai kontrak simulasi terautentikasi. Web UI masih memakai adapter demo browser; kunci backend tidak dikirim ke browser.
- Metadata backend tersimpan atomik di `.data/studio-state.json`; referensi dan output mempunyai direktori terpisah. Folder `.data` diabaikan Git dan perlu dipetakan ke volume persisten saat deployment.
- Belum ada inferensi model, audio keluaran, konversi MP3, autentikasi pengguna Web UI, atau kontrol Pod sungguhan. Kemampuan dan kualitas suara VoxCPM2 masih harus diuji pada fase GPU.

## Pemeriksaan

```powershell
npm run typecheck
npm run lint
npm test
.\.venv\Scripts\python.exe -m pytest worker\tests -q
npm run build
```

Pengujian Node memakai `node:test`; pengujian worker memakai `pytest`. Keduanya tidak membutuhkan GPU atau koneksi RunPod. Selain frontend, pengujian mencakup persistensi server, pembatasan path, kontrak health/readiness, autentikasi worker, idempotensi, antrean tunggal, pembatalan, dan kegagalan simulasi.

Integrasi Next.js ↔ FastAPI telah diuji lokal: sesi, pekerjaan normal/idempoten, polling, unggah serta baca ulang WAV, cloning simulasi, pembatalan, penghapusan referensi, dan stop sesi. Image Docker belum dibangun karena Docker tidak tersedia pada mesin pengembangan ini.

Pemeriksaan UI manual mencakup desktop dan ponsel, input tidak valid, unggah WAV, pemutaran setelah refresh, cloning demo, pembatalan, riwayat, dan fokus dialog. Rincian hasil ada di [progress.md](progress.md).

## Struktur kode

```text
src/app/                  Route, layout, loading/error, dan gaya
src/components/           Halaman interaktif dan komponen bersama
src/lib/types.ts          Kontrak service dan tipe data
src/lib/demo-service.ts   State machine simulasi, validasi, persistensi metadata
src/lib/audio-storage.ts  Penyimpanan dan validasi audio di browser
src/lib/fixtures.ts       Naskah, inspirasi, profil GPU, dan label demo
src/lib/webmcp.ts         Peningkatan opsional untuk browser yang mendukung WebMCP
src/server/               Persistensi, validasi, autentikasi, dan client worker
src/app/api/v1/           Route Handler API aplikasi
worker/app/               Worker FastAPI mode simulasi
worker/tests/             Pengujian kontrak worker
docs/                     API lokal dan rancangan kontrol RunPod
tests/                    Pengujian frontend dan backend Node
```

Halaman memakai kontrak `StudioService` melalui provider. Adapter API dapat menggantikan service demo pada langkah berikutnya setelah autentikasi pengguna Web UI ditetapkan. Kontrak dan penyimpanan server telah tersedia di Fase 4. Gunakan [progress.md](progress.md) sebagai urutan pekerjaan dan catatan keputusan; rancangan shutdown cloud ada di [docs/runpod-worker-design.md](docs/runpod-worker-design.md).

WebMCP dideteksi secara opsional melalui `document.modelContext`. Jika tersedia, dua alat membaca status demo dan mengganti draft memakai state yang sama dengan UI. Pendaftaran dibersihkan dengan `AbortSignal`; browser tanpa dukungan tetap dapat memakai seluruh UI. Verifikasi dalam konteks WebMCP yang mendukung belum dilakukan; fitur ini bukan prasyarat demo lokal.

Stack: Next.js App Router, React, TypeScript, Tailwind CSS, Radix Dialog, Lucide, Geist lokal, FastAPI, Pydantic, dan Uvicorn. Versi Node dikunci di `package-lock.json`; dependensi worker dikunci di `worker/requirements*.txt`. Baca panduan Next.js yang ikut terpasang di `node_modules/next/dist/docs/` sebelum perubahan terkait framework.
