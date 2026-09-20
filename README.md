# VoxCPM Studio

Web UI pribadi berbahasa Indonesia untuk merancang alur TTS, Voice Design, dan voice cloning. **Fase 1–3 berjalan sebagai demo lokal. Belum terhubung ke VoxCPM2 atau RunPod dan belum menghasilkan audio AI.**

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
- Tidak ada API aplikasi, worker FastAPI, inferensi model, audio keluaran, konversi MP3, autentikasi, atau kontrol Pod sungguhan. Kemampuan dan kualitas suara VoxCPM2 masih harus diuji pada fase GPU.

## Pemeriksaan

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

Pengujian otomatis memakai `node:test` dan jam terkontrol untuk alur sesi/pekerjaan. Tidak membutuhkan browser, GPU, atau koneksi RunPod. Skenario yang diuji mencakup klik ganda, pembatalan, restart, refresh, data rusak, batas harga, tenggat, idle timeout, batas perpanjangan, serta kegagalan worker.

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
tests/                    Pengujian perilaku service dengan jam terkontrol
```

Halaman memakai kontrak `StudioService` melalui provider. Adapter API nantinya dapat menggantikan service demo; penyimpanan audio lokal perlu diganti/ditambah jalur berkas backend pada Fase 4. Gunakan [progress.md](progress.md) sebagai urutan pekerjaan dan catatan keputusan.

WebMCP dideteksi secara opsional melalui `document.modelContext`. Jika tersedia, dua alat membaca status demo dan mengganti draft memakai state yang sama dengan UI. Pendaftaran dibersihkan dengan `AbortSignal`; browser tanpa dukungan tetap dapat memakai seluruh UI. Verifikasi dalam konteks WebMCP yang mendukung belum dilakukan; fitur ini bukan prasyarat demo lokal.

Stack: Next.js App Router, React, TypeScript, Tailwind CSS, Radix Dialog, Lucide, dan Geist yang dibundel lokal. Versi dependensi dikunci di `package-lock.json`. Baca panduan Next.js yang ikut terpasang di `node_modules/next/dist/docs/` sebelum perubahan terkait framework.
