# Progress — VoxCPM Studio

Terakhir diperbarui: 21 September 2026
Status: **Fase 0–4A selesai; implementasi Fase 4B selesai lokal dan menunggu validasi build image GPU di CI.**
Fase aktif: **Fase 4B — paket VoxCPM2/CUDA disiapkan tanpa membuat resource RunPod; saldo masih $0,00.**

## 1. Tujuan dan batas pekerjaan saat ini

Membangun aplikasi pribadi untuk TTS Bahasa Indonesia, voice cloning, dan voice design menggunakan VoxCPM2 dengan GPU RunPod yang dinyalakan sesuai kebutuhan. Nama kerja aplikasi: **VoxCPM Studio**.

**Pekerjaan lokal tanpa biaya telah diprioritaskan; frontend, backend, container simulasi, autentikasi Web UI, adapter API, dan implementasi paket GPU sudah selesai. Pengguna belum mempunyai saldo RunPod.** Fase 5 tidak boleh membuat resource berbayar sampai saldo, batas harga, durasi uji, dan strategi storage siap.

- Frontend: Next.js, React, TypeScript, Tailwind CSS; gunakan shadcn/ui bila sesuai kebutuhan komponen.
- Antarmuka berbahasa Indonesia; fokus pada penggunaan desktop, tetap nyaman di layar kecil.
- Next.js server nantinya menangani kontrol aplikasi dan komunikasi RunPod. FastAPI pada GPU worker nantinya menjalankan VoxCPM2.
- Gunakan penyedia data simulasi terlebih dahulu, dengan kontrak yang dapat dipakai kembali oleh integrasi sebenarnya.
- Jangan menandai TTS, cloning, voice design, pembayaran, atau kontrol GPU sebagai berfungsi nyata hanya karena simulasinya berjalan.
- MVP berfokus pada satu pengguna dan satu GPU worker. Multi-user, dubbing, voice changer, musik, dan sound effects berada di luar MVP.

## 2. Aturan checklist dan pembaruan progres

- `[x]` berarti hasil pekerjaan sudah ada dan sudah diperiksa sesuai kriteria fase.
- `[ ]` berarti belum dikerjakan, sedang dikerjakan, atau belum lolos pemeriksaan. Jika sedang dikerjakan, tambahkan catatan singkat.
- Tugas UI dengan data simulasi harus disebut sebagai **simulasi**, bukan integrasi selesai.
- Setiap sesi pengerjaan memperbarui checklist, tanggal, hasil verifikasi, kendala, dan langkah berikutnya.
- Bila implementasi berubah, perbarui rencana agar mencerminkan keputusan terakhir.
- Fase dinyatakan selesai setelah seluruh pekerjaan wajib dan kriteria selesainya terpenuhi.

## 3. Fase 0 — Konteks dan perencanaan

- [x] Memahami kebutuhan: Web UI pribadi, TTS Indonesia, cloning, voice design, riwayat, serta GPU sesuai kebutuhan.
- [x] Meninjau percakapan awal dan mencatat koreksi arsitektur serta batas kemampuan model.
- [x] Memeriksa workspace `D:\Project\tts-runpod`: kosong sebelum dokumen ini dibuat.
- [x] Menetapkan urutan frontend terlebih dahulu karena saldo RunPod belum tersedia.
- [x] Menyusun fase, checklist, batas MVP, dan kriteria selesai di `progress.md`.

**Hasil pada akhir Fase 0:** dokumen rencana tersedia. Implementasi frontend kemudian diselesaikan pada Fase 1–3; rincian verifikasi tercatat di bawah.

## 4. Fase 1 — Fondasi frontend Web UI

### 1.1 Inisialisasi aplikasi

- [x] Membuat proyek Next.js dengan App Router, React, TypeScript, dan Tailwind CSS.
- [x] Menetapkan package manager dan menyimpan lockfile.
- [x] Menyediakan perintah development, build, lint, dan pemeriksaan TypeScript.
- [x] Menambahkan `.gitignore`, README untuk menjalankan aplikasi lokal, dan contoh konfigurasi tanpa rahasia.
- [x] Membuat struktur folder halaman, komponen, tipe data, dan penyedia data simulasi yang mudah dipahami.

### 1.2 Kerangka dan desain

- [x] Membuat navigasi: **Studio**, **Pustaka Suara**, **Riwayat**, **Sesi GPU**, dan **Pengaturan**.
- [x] Menetapkan warna, tipografi, jarak, bentuk input, tombol, kartu, serta indikator status yang konsisten.
- [x] Membuat kerangka halaman responsif dengan navigasi yang berfungsi.
- [x] Menampilkan label **Mode Demo** dan penjelasan singkat bahwa GPU serta biaya masih disimulasikan.
- [x] Menyiapkan komponen bersama untuk loading, empty state, pesan error, notifikasi, dan dialog.

**Kriteria selesai:** aplikasi dapat dijalankan dan dibangun secara lokal; seluruh halaman dapat dibuka; tata letak dasar nyaman digunakan; tidak membutuhkan RunPod.

**Hasil terverifikasi:** Next.js App Router, npm + lockfile, lima halaman lokal, komponen dialog Radix, tipografi Geist lokal, ikon Lucide, dan Tailwind tersedia. `README.md` serta `.env.example` menjelaskan cara menjalankan tanpa kredensial. Panduan Next.js di `node_modules/next/dist/docs/` dibaca sesuai `AGENTS.md`.

## 5. Fase 2 — Tampilan halaman utama

### 2.1 Studio

- [x] Membuat editor teks dengan penghitung karakter, contoh naskah Indonesia, dan validasi input kosong.
- [x] Menyediakan pilihan mode: TTS biasa, Voice Design, Cloning dengan Gaya, dan Hi-Fi Cloning.
- [x] Membuat pemilihan suara dari pustaka serta input referensi audio sesuai mode.
- [x] Menyediakan deskripsi suara untuk Voice Design dan transkrip referensi untuk Hi-Fi Cloning.
- [x] Menyediakan preset gaya sederhana, misalnya Natural, Tenang, Ceria, dan Dramatis.
- [x] Menonaktifkan kontrol gaya saat Hi-Fi dipilih, disertai penjelasan singkat mengenai batas mode tersebut.
- [x] Membuat tombol aksi demo, tampilan antrean/progres, hasil audio, serta area pesan kegagalan.
- [x] Membuat audio player dan tombol unduh yang hanya aktif jika memang ada berkas audio.

### 2.2 Pustaka Suara

- [x] Membuat daftar suara, pencarian, detail suara, dan keadaan pustaka kosong.
- [x] Membuat form nama, catatan, dan unggah referensi audio.
- [x] Menyediakan preview audio lokal, informasi durasi, serta validasi format dan ukuran.
- [x] Menyediakan edit dan hapus referensi yang jelas bagi pengguna.
- [x] Membedakan suara contoh, referensi milik pengguna, dan suara hasil desain yang nantinya disimpan.

### 2.3 Riwayat

- [x] Menampilkan teks, suara, mode, waktu, status, dan durasi audio bila tersedia.
- [x] Menyediakan detail pekerjaan, pencarian/filter, gunakan ulang pengaturan, dan unduh bila hasil tersedia.
- [x] Menyediakan tampilan untuk pekerjaan berhasil, gagal, dibatalkan, dan belum mempunyai hasil.

### 2.4 Sesi GPU dan Pengaturan

- [x] Menampilkan status GPU, profil GPU contoh, waktu sesi, countdown, dan estimasi biaya demo.
- [x] Membuat kontrol simulasi Mulai Sesi, Akhiri Sesi, dan Perpanjang Waktu.
- [x] Menyediakan pengaturan batas sesi, idle timeout, dan batas harga GPU sebagai rancangan konfigurasi.
- [x] Membuat halaman preferensi aplikasi tanpa meminta API key RunPod pada tahap demo.
- [x] Menjelaskan bahwa status Pod hidup dan model siap menghasilkan audio adalah dua kondisi berbeda.

**Kriteria selesai:** seluruh tampilan MVP tersedia dan konsisten. Setiap kontrol menunjukkan dengan jujur apakah aktif, belum tersedia, atau masih simulasi.

**Hasil terverifikasi:** seluruh halaman dan kontrol demo tersedia. Pustaka memisahkan inspirasi deskripsi dari rekaman unggahan. Tipe `designed` disiapkan dalam kontrak; penyimpanan suara desain nyata menunggu inferensi. Player referensi memutar berkas asli lokal. Player/unduh hasil sintesis disiapkan tetapi tetap nonaktif jika tidak ada berkas; tidak ada audio keluaran contoh yang diklaim sebagai hasil AI.

## 6. Fase 3 — Interaksi frontend dengan data simulasi

### 3.1 Kontrak data dan skenario demo

- [x] Mendefinisikan tipe `Voice`, `SynthesisRequest`, `SynthesisJob`, `GpuSession`, dan `AppSettings`.
- [x] Memisahkan logika komponen dari penyedia data agar mock dapat diganti dengan API tanpa menulis ulang halaman.
- [x] Memodelkan status GPU: off, provisioning, loading model, ready, stopping, dan error.
- [x] Memodelkan status pekerjaan secara terpisah: queued, running, succeeded, failed, dan cancelled.
- [x] Menyimulasikan alur mulai sesi → pemuatan model → siap → antrean pekerjaan → hasil/error → akhir sesi.
- [x] Menyediakan skenario GPU tidak tersedia, pemuatan lambat, kegagalan pekerjaan, dan koneksi terputus.
- [x] Mencegah klik berulang membuat sesi atau pekerjaan ganda.
- [x] Menggunakan audio contoh yang sumbernya jelas jika diperlukan; jangan mengakuinya sebagai hasil dari teks yang baru diketik.

### 3.2 Penyimpanan lokal dan pengalaman penggunaan

- [x] Menyimpan draft teks serta preferensi yang tidak sensitif secara lokal, dengan versi format data.
- [x] Menyimpan metadata dan referensi audio lokal menggunakan penyimpanan yang sesuai, misalnya IndexedDB untuk berkas.
- [x] Memastikan draft tetap tersedia setelah refresh dan referensi audio dapat diputar kembali.
- [x] Menyediakan penghapusan data demo/lokal yang jelas cakupannya.
- [x] Memastikan unggah pada mode demo hanya diproses lokal dan tidak dikirim ke layanan cloud.
- [x] Menangani navigasi keyboard, label input, fokus dialog, kontras, dan tampilan responsif.

### 3.3 Verifikasi frontend

- [x] Memeriksa alur utama: unggah referensi → isi teks → jalankan simulasi → lihat hasil/status → buka riwayat.
- [x] Memeriksa pembatalan, percobaan ulang, input tidak valid, refresh, dan pemulihan draft.
- [x] Memeriksa countdown demo tanpa menganggapnya sebagai pengaman biaya sebenarnya.
- [x] Menjalankan build, lint, dan pemeriksaan TypeScript; menyelesaikan error yang ditemukan.
- [x] Menambahkan pengujian otomatis untuk alur berisiko seperti pekerjaan ganda dan transisi status bila diperlukan.
- [x] Meninjau tampilan di browser pada ukuran desktop dan layar kecil.

**Kriteria selesai:** frontend dapat dipakai untuk demonstrasi alur MVP dari awal sampai akhir, tanpa saldo RunPod. Integrasi GPU dan kualitas suara belum dinyatakan teruji.

**Hasil verifikasi, 20 September 2026:**

| Pemeriksaan | Hasil |
| --- | --- |
| `npm run typecheck` | Lulus. |
| `npm run lint` | Lulus tanpa error atau warning ESLint. |
| `npm test` | 12/12 lulus: klik ganda, stop saat loading, pembatalan/retry, refresh, data rusak, tenggat, idle, perpanjangan maksimum, validasi/batas harga, kegagalan/koneksi terputus, GPU tidak tersedia, dan reset. |
| `npm run build` | Lulus; seluruh route utama dan halaman not-found berhasil dibangun. |
| Browser Chrome desktop | Kelima halaman dibuka; Studio, Riwayat, serta Sesi GPU ditinjau pada viewport desktop 1440 × 900. |
| Browser Chrome layar kecil | Studio, Pengaturan, Pustaka Suara, dan menu diuji pada viewport 390 × 844. Studio tidak meluap secara horizontal. Escape menutup dialog dan fokus kembali ke pemicu. |
| Input dan rekaman | Naskah kosong dan berkas `.txt` ditolak; WAV uji 8 detik berhasil dibaca, disimpan, diputar sesudah refresh, dipilih untuk cloning demo, diedit, dicari, dan dihapus. |
| Alur pekerjaan | Simulasi selesai tanpa audio palsu; riwayat/detail tersedia; pembatalan berfungsi; Hi-Fi menonaktifkan gaya; perpanjangan, akhir sesi, serta skenario GPU tidak tersedia diverifikasi melalui UI. |
| Reset | Data yang dibuat selama QA dihapus melalui UI; kembali ke 0 referensi lokal dan 0 pekerjaan, skenario Normal, serta draft awal. Tidak menghapus berkas asli pengguna. |

**Keputusan dan batas yang tersisa:**

- Metadata versi 1 memakai `localStorage`; berkas audio memakai IndexedDB. Unggahan demo tidak melakukan permintaan ke cloud. Gunakan satu tab; sinkronisasi antartab belum diterapkan.
- Reload menonaktifkan sesi dan membatalkan pekerjaan yang belum selesai. Draft, preferensi, metadata, dan audio referensi dipulihkan.
- Tarif GPU adalah angka contoh. Timer browser belum melindungi biaya cloud; API backend dan worker simulasi sudah ada, tetapi belum ada integrasi RunPod, inferensi model, atau pengujian kualitas suara.
- Pengujian browser dilakukan di Chrome, bukan sertifikasi lintas browser atau audit aksesibilitas formal.
- WebMCP ditambahkan sebagai peningkatan opsional dengan deteksi dukungan. Verifikasi registrasi/pemanggilan dalam konteks WebMCP yang mendukung belum dilakukan; tidak menghalangi demo lokal dan tidak diklaim telah lolos.

## 7. Fase 4 — Backend aplikasi dan persiapan worker tanpa GPU berbayar

- [x] Mengimplementasikan API aplikasi di Next.js sesuai kontrak frontend.
- [x] Menetapkan penyimpanan metadata pekerjaan, pustaka suara, konfigurasi, dan lokasi berkas untuk penggunaan pribadi.
- [x] Menyimpan metadata penting agar tidak bergantung pada umur Pod GPU.
- [x] Membuat kerangka FastAPI worker dengan endpoint health, kesiapan model, dan pekerjaan sintesis.
- [x] Menyediakan backend simulasi worker agar kontrak API dapat diuji tanpa GPU.
- [x] Menambahkan validasi permintaan, ID pekerjaan, timeout, pembatalan, dan penanganan retry tanpa duplikasi.
- [x] Melindungi endpoint worker dan endpoint pengelolaan sesi; rahasia hanya berada di backend.
- [x] Membuat Dockerfile dan startup script dengan versi dependensi yang terkunci.
- [x] Mengatur lokasi model/cache, referensi, serta output pada storage persisten; memeriksa mount sebelum menjalankan worker.
- [x] Menguji build container dan alur API yang tidak membutuhkan GPU. Docker tidak tersedia lokal, sehingga validasi dijalankan pada GitHub Actions tanpa membuat resource RunPod.
- [x] Merancang pengawas shutdown di cloud, tenggat tersimpan, pemulihan setelah restart, dan pemeriksaan hasil penghentian.
- [x] Mendokumentasikan konfigurasi RunPod yang dibutuhkan tanpa membuat resource berbayar.

**Hasil verifikasi Fase 4, 21 September 2026:**

- Next.js menyediakan health, sesi, perpanjangan, pekerjaan, polling, cancel, pustaka referensi, audio referensi, dan pengaturan melalui `/api/v1/*`.
- Metadata versi 1 ditulis atomik ke `.data/studio-state.json`; referensi dan output berada di direktori terpisah. Riwayat dibatasi 100 pekerjaan.
- Worker FastAPI memisahkan liveness dari readiness, menandai pekerjaan aktif gagal setelah restart, membatasi satu pekerjaan, serta menolak referensi di luar mount.
- Endpoint pengelolaan aplikasi dan worker sama-sama menghasilkan `401` tanpa kunci yang tepat. Kunci berbeda dan tidak memakai `NEXT_PUBLIC_*`.
- 15/15 pengujian Node dan 4/4 pengujian worker lulus. TypeScript serta ESLint lulus.
- Seluruh wheel produksi yang dikunci tersedia untuk target Linux x86_64 / CPython 3.12 yang dipakai Dockerfile.
- Build Next.js lulus dan menemukan sepuluh route API dinamis.
- [GitHub Actions run 35540568742](https://github.com/Muhira007/VoxCPM-Studio/actions/runs/35540568742) berhasil membangun image worker dari nol, menjalankan container sebagai UID `10001`, memverifikasi liveness, penolakan tanpa kunci, readiness terautentikasi, pekerjaan simulasi tanpa audio, persistensi setelah restart, dan status Docker `healthy`.
- Uji integrasi lokal Next.js ↔ FastAPI lulus: health/readiness, start/stop sesi, pekerjaan normal dan idempoten, polling, unggah/baca ulang WAV 256.044 byte, cloning simulasi, cancel, serta hapus referensi. Tidak ada audio sintesis yang dibuat.
- `docs/backend-api.md` menjelaskan operasi lokal; `docs/runpod-worker-design.md` merinci lease, deadline cloud, retry stop, verifikasi penghentian, storage, dan keamanan tanpa membuat resource berbayar.

**Batas pada akhir Fase 4:** Web UI masih memakai service demo browser dan adapter API menunggu autentikasi sesi `HttpOnly`. Batas ini kemudian diselesaikan pada Fase 4A. Worker Docker tetap mode simulasi dan belum berisi VoxCPM2/CUDA.

**Kriteria selesai:** backend dan kontrak worker dapat diuji secara lokal. Container siap untuk pengujian GPU berikutnya. Inference VoxCPM2 tetap belum dianggap lolos sebelum diuji pada GPU.

**Status fase:** selesai. Seluruh checklist wajib telah lulus, termasuk build dan health check container pada lingkungan Linux Docker di GitHub Actions.

## 8. Fase 4A — Autentikasi Web UI dan adapter API lokal

- [x] Menyediakan pilihan adapter `demo` atau `api` tanpa menaruh rahasia pada variabel publik.
- [x] Membuat login kata sandi lokal dengan token HMAC berumur 12 jam pada cookie `HttpOnly` dan `SameSite=Strict`.
- [x] Menambahkan status sesi, logout, pembatasan percobaan login, dan pemeriksaan same-origin untuk mutasi berbasis cookie.
- [x] Mempertahankan `X-Studio-Key` untuk klien terminal tepercaya, tanpa mengirimnya ke browser.
- [x] Membuat adapter `StudioService` API untuk sesi, pengaturan, pekerjaan, polling detail, pembatalan, dan reset backend.
- [x] Menghubungkan unggah, putar, edit, serta hapus referensi audio ke penyimpanan server lokal.
- [x] Menyesuaikan label UI agar Mode Demo browser dan Mode API Lokal tidak tertukar.
- [x] Menguji login/logout, origin guard, polling, pekerjaan simulasi, referensi audio, reset, serta tampilan browser.

**Hasil verifikasi Fase 4A, 21 September 2026:**

- Cookie login memiliki `HttpOnly` dan `SameSite=Strict`; kata sandi salah menghasilkan `401`, mutasi cookie tanpa origin menghasilkan `403`, dan logout menghapus sesi.
- Browser berhasil membuka Mode API Lokal tanpa menerima `STUDIO_API_KEY`, menyiapkan worker, membuat pekerjaan, dan berpindah dari `queued` ke `succeeded` melalui polling endpoint detail.
- Integrasi browser ↔ Next.js ↔ FastAPI lulus untuk sesi, pekerjaan tanpa audio palsu, unggah/baca ulang WAV 44 byte, edit metadata suara, reset backend, dan logout.
- 22/22 pengujian Node lulus, termasuk token kedaluwarsa/tamper, origin guard, sesi browser kedaluwarsa, receiver `fetch`, pemetaan adapter, serta polling status. TypeScript, ESLint, dan build produksi mode API lulus.
- [GitHub Actions run 35566625556](https://github.com/Muhira007/VoxCPM-Studio/actions/runs/35566625556) lulus pada runner Ubuntu dengan Node.js 24: instalasi bersih, 22/22 pengujian Node, pemeriksaan TypeScript, ESLint, dan build produksi.
- Data integrasi direset, dua proses pengujian dihentikan, dan `.env.local` berisi rahasia uji dihapus setelah pemeriksaan.

**Batas pada akhir Fase 4A:** autentikasi ini ditujukan untuk aplikasi pribadi satu pengguna. Sesi bersifat stateless; mengganti `STUDIO_SESSION_SECRET` membatalkan cookie lama. Worker masih mode simulasi; paket VoxCPM2/CUDA kemudian disiapkan pada Fase 4B.

**Kriteria selesai:** pengguna dapat masuk melalui Web UI, memakai seluruh alur API lokal tanpa melihat kunci server, memantau pekerjaan sampai terminal, lalu keluar. Alur ini telah lulus melalui browser dan pengujian otomatis.

**Status fase:** selesai.

## 9. Fase 4B — Paket worker GPU tanpa membuat Pod

- [x] Memeriksa ulang repository, dokumentasi, rilis PyPI, dan model card resmi VoxCPM2.
- [x] Memilih VoxCPM `2.0.3`, snapshot model commit `32279effe8c19989596f05d353d1447f51d9e915`, serta base RunPod PyTorch/CUDA berversi.
- [x] Mengunci pasangan PyTorch `2.8.0`, TorchAudio `2.8.0`, TorchCodec `0.7.0`, dan dependensi langsung VoxCPM dari lock rilis upstream.
- [x] Menambahkan `WORKER_MODE=voxcpm2` dengan preflight package, CUDA, versi, dan batas minimum VRAM.
- [x] Memuat model di latar belakang dengan readiness `loading`, `ready`, atau `error`, terpisah dari liveness.
- [x] Memetakan TTS, Voice Design, controllable cloning, dan Hi-Fi cloning ke API Python VoxCPM2 `2.0.3`.
- [x] Menyimpan WAV secara atomik, membuang hasil pekerjaan yang dibatalkan, serta menjaga satu eksekusi GPU pada satu waktu.
- [x] Mengunggah referensi dari backend ke worker dan mengunduh hasil audio worker kembali ke storage aplikasi tanpa membuka kunci worker ke browser.
- [x] Menyediakan endpoint audio hasil terautentikasi pada worker dan API aplikasi.
- [x] Membuat `worker/Dockerfile.gpu`, startup UID `10001`, mount `/workspace`, health check, dan dokumentasi template RunPod.
- [x] Menguji kontrak baru tanpa GPU memakai fake runtime serta seluruh regresi simulasi/frontend/backend.
- [ ] Membangun image GPU dari nol pada GitHub Actions dan memverifikasi package serta startup fail-closed tanpa CUDA. Menunggu push dan hasil workflow.

**Hasil verifikasi lokal Fase 4B, 21 September 2026:**

- Sumber resmi menyatakan VoxCPM2 mendukung Bahasa Indonesia, output 48 kHz, Python 3.10–3.12, PyTorch minimal 2.5, CUDA minimal 12, serta sekitar 8 GB VRAM; pilihan uji pertama tetap GPU 24 GB untuk ruang runtime.
- Backend tidak lagi mengirim path Windows ke worker jarak jauh. Referensi diunggah dengan ID aman dan batas 20 MB; output worker dibatasi 100 MB sebelum disimpan oleh aplikasi.
- Pemetaan empat mode dan penulisan WAV diuji tanpa mengimpor model nyata. Hasil ini memvalidasi adapter, bukan inferensi GPU atau kualitas suara.
- 7/7 pengujian worker dan 22/22 pengujian Node lulus. TypeScript dan ESLint lulus.
- Rancangan dan konfigurasi terdapat di `docs/gpu-worker-package.md`. Tidak ada Pod, volume, API key RunPod, atau biaya cloud yang dibuat.

**Batas saat ini:** image belum selesai dibangun di CI dan belum dijalankan dengan NVIDIA GPU. Bobot model belum diunduh, WAV AI belum dihasilkan, sample rate belum diperiksa dari berkas nyata, dan kebutuhan VRAM/cold start belum diukur.

**Kriteria selesai:** image GPU dapat dibangun reproducibly tanpa GPU, versi inti terverifikasi, startup tanpa CUDA gagal jelas, dan kontrak transfer referensi/hasil lolos. Inferensi tetap menunggu Fase 5.

**Status fase:** implementasi lokal selesai; validasi container CI masih terbuka.

## 10. Fase 5 — Integrasi RunPod setelah saldo tersedia

**Prasyarat:** saldo tersedia, konfigurasi akun siap, serta batas harga dan durasi pengujian ditetapkan bersama pengguna. Pemeriksaan read-only pada 21 September 2026 menunjukkan saldo `$0,00` dan pemakaian `$0/jam`; belum ada resource berbayar yang dibuat.

### 5.1 Infrastruktur dan pemulihan sesi

- [ ] Memeriksa harga aktual, ketersediaan GPU, data center, storage, dan kompatibilitas image.
- [ ] Menentukan strategi storage; Network Volume biasa membatasi pilihan data center.
- [ ] Menyiapkan API key hanya di environment backend, bukan browser atau variabel publik Next.js.
- [ ] Mengintegrasikan buat/resume sesi, polling status, kesiapan model, dan akhiri sesi.
- [ ] Membedakan stop dan terminate pada implementasi; hanya menghapus Pod setelah lokasi data persisten diverifikasi.
- [ ] Menguji satu siklus deploy → muat model → sintesis → simpan hasil → akhiri sesi → deploy ulang.
- [ ] Memastikan model tidak perlu diunduh ulang tanpa alasan dan dependensi tersedia setelah Pod dibuat ulang.
- [ ] Mengukur cold start dan menunjukkan tahap kesiapan yang sebenarnya di UI.

### 5.2 Pengaman penggunaan biaya

- [ ] Menjalankan timer sebenarnya di cloud sehingga tetap bekerja ketika browser ditutup atau PC mati.
- [ ] Mengaktifkan idle shutdown hanya ketika tidak ada pekerjaan berjalan atau antrean yang perlu diproses.
- [ ] Menetapkan batas sesi maksimum dan perilaku pekerjaan saat tenggat mendekat agar biaya tidak diperpanjang tanpa batas.
- [ ] Memastikan perpanjangan waktu memperbarui tenggat di cloud.
- [ ] Memastikan kegagalan API penghentian terdeteksi, dicoba ulang secara terbatas, dan terlihat oleh pengguna.
- [ ] Memverifikasi status penghentian pada RunPod; timer habis saja bukan bukti tagihan GPU telah berhenti.
- [ ] Menampilkan estimasi biaya dengan jelas, termasuk waktu startup/idle dan biaya storage terpisah.

**Kriteria selesai:** kontrol GPU bekerja nyata, data bertahan setelah sesi berakhir, dan shutdown berhasil diuji dengan browser tertutup serta PC pengguna tidak menjalankan pengawas lokal.

## 11. Fase 6 — Validasi kualitas suara dan penyelesaian MVP

- [ ] Memverifikasi ulang API serta kemampuan versi VoxCPM2 yang dipasang menggunakan repo upstream.
- [ ] Menguji TTS Indonesia, voice design, cloning dengan gaya, dan Hi-Fi cloning secara terpisah.
- [ ] Menyiapkan 20–30 naskah uji: narasi, dialog, rupiah, tanggal, singkatan, nama, dan campuran Indonesia–Inggris.
- [ ] Menguji referensi audio bersih dan transkrip yang sesuai; menyediakan panduan input di UI.
- [ ] Menguji efektivitas setiap preset gaya dan menghapus atau menandai preset yang belum konsisten.
- [ ] Menyimpan referensi suara pilihan untuk menjaga identitas antar-generasi.
- [ ] Menambahkan normalisasi teks Indonesia dan kamus pengucapan sederhana berdasarkan kesalahan nyata yang ditemukan.
- [ ] Menangani teks panjang dengan pembagian segmen, jeda, dan penggabungan audio yang diperiksa lewat uji dengar.
- [ ] Menyediakan regenerasi satu segmen tanpa mengulang seluruh naskah.
- [ ] Mengaktifkan unduh WAV dan konversi MP3 hanya setelah alur berkas sebenarnya diuji.
- [ ] Mengukur waktu proses, penggunaan VRAM, kegagalan/retry, dan biaya per menit audio yang layak dipakai.
- [ ] Memeriksa alur MVP menyeluruh, keamanan endpoint, pemulihan pekerjaan, dan backup hasil penting.
- [ ] Memperbarui README serta batas fitur berdasarkan hasil pengujian, bukan asumsi.

**Kriteria selesai:** pengguna dapat menghasilkan dan mengunduh audio nyata, mengulang bagian yang bermasalah, serta mengakhiri sesi GPU dengan hasil tersimpan. Kualitas dan biaya dilaporkan dari pengukuran.

## 12. Pengembangan lanjutan — di luar syarat selesai MVP

- [ ] Editor dialog multi-speaker dengan suara dan gaya per segmen.
- [ ] Perbandingan beberapa kandidat hasil audio.
- [ ] Streaming audio setelah jalur sintesis biasa stabil.
- [ ] Pemilihan GPU otomatis berdasarkan pengukuran biaya, kompatibilitas, dan lokasi storage.
- [ ] Evaluasi Global Volumes untuk model yang perlu diakses lintas data center; periksa status beta dan karakteristik penyimpanannya saat implementasi.
- [ ] Evaluasi vLLM-Omni atau engine lain jika antrean dan kebutuhan throughput membenarkannya.
- [ ] Migrasi ke Serverless atau multi-user jika pola penggunaan sudah membutuhkan.

## 13. Catatan teknis yang harus dipertahankan

1. **Frontend dahulu:** mode demo tidak membuat resource, tidak mengonsumsi saldo, dan tidak mengklaim menghasilkan suara AI nyata.
2. **Persistensi:** folder source di `/workspace` tidak otomatis membuat seluruh environment Python persisten. Dependensi harus tersedia dalam image atau environment yang sengaja dikelola.
3. **Shutdown:** backend pada PC lokal tidak memenuhi kebutuhan shutdown ketika PC mati. Pengawas biaya harus berjalan di cloud.
4. **Kemampuan model:** kontrol berbasis deskripsi tidak menjamin persentase emosi, pitch, atau kecepatan yang presisi. Jangan menjanjikan slider tersebut sebelum ada implementasi dan pengujian yang mendukung.
5. **Mode cloning:** menurut audit dokumentasi, Hi-Fi mengabaikan instruksi gaya. Verifikasi ulang terhadap versi yang dipasang sebelum integrasi.
6. **Identitas suara:** voice design dari deskripsi saja tidak menjamin suara yang sama pada setiap generasi; simpan referensi pilihan.
7. **Storage:** stop, terminate, dan menghapus volume memiliki konsekuensi berbeda. Lokasi mount serta hasil tersimpan harus diverifikasi.
8. **Biaya:** harga GPU per jam tidak cukup untuk menentukan pilihan termurah. Sertakan startup, idle, retry, storage, dan jumlah audio yang berhasil digunakan.
9. **Keamanan:** API key RunPod tidak boleh berada di browser, localStorage, IndexedDB, repository, atau variabel `NEXT_PUBLIC_*`. Endpoint GPU yang dapat diakses lewat jaringan harus dilindungi.
10. **Kualitas:** dukungan Indonesia dan sample rate 48 kHz belum membuktikan hasil setara ElevenLabs. Gunakan uji dengar dengan naskah yang relevan.

Rujukan audit untuk diperiksa kembali saat integrasi:

- [Repo upstream VoxCPM](https://github.com/OpenBMB/VoxCPM)
- [Panduan mode dan parameter VoxCPM](https://voxcpm.readthedocs.io/en/latest/usage_guide.html)
- [Pengelolaan Pod RunPod](https://docs.runpod.io/pods/manage-pods)
- [Penyimpanan RunPod](https://docs.runpod.io/pods/storage/types)
- [Network Volumes](https://docs.runpod.io/storage/network-volumes)
- [Custom template RunPod](https://docs.runpod.io/pods/templates/create-custom-template)
- [Harga RunPod](https://www.runpod.io/pricing)

## 14. Log progres

| Tanggal | Hasil | Verifikasi | Kendala / langkah berikutnya |
| --- | --- | --- | --- |
| 20 September 2026 | Konteks dan audit dirangkum; roadmap frontend terlebih dahulu dibuat. | Workspace diperiksa dan kosong sebelum dokumen dibuat. Tidak ada implementasi aplikasi yang ditandai selesai. | Mulai Fase 1: inisialisasi Next.js dan kerangka halaman. Saldo RunPod belum tersedia; tidak menghalangi Fase 1–4. |
| 20 September 2026 | Fase 1 selesai: fondasi Next.js, lima route, desain, komponen bersama, dan panduan lokal. | Build, lint, TypeScript lulus; seluruh halaman dapat dibuka. | Tetap lokal, tanpa hosting atau resource cloud. |
| 20 September 2026 | Fase 2 selesai: Studio, pustaka referensi, riwayat, Sesi GPU, dan Pengaturan tersedia. | Tinjauan desktop/ponsel serta kontrol utama melalui Chrome. | Hasil sintesis dan unduhan audio nyata menunggu model/GPU. |
| 20 September 2026 | Fase 3 selesai: service simulasi, persistensi lokal, skenario kegagalan, dan pembatalan. | 12/12 pengujian otomatis; alur WAV → cloning demo → riwayat, refresh, edit/hapus, dan reset diverifikasi. | Backend/worker lokal pada Fase 4 belum dikerjakan; saldo RunPod belum diperlukan untuk fase tersebut. |
| 21 September 2026 | API Next.js, penyimpanan server, worker FastAPI simulasi, Dockerfile, dan rancangan kontrol cloud ditambahkan. | 15/15 tes Node, 4/4 tes worker, lint, TypeScript, build Next.js, serta integrasi dua proses lulus. | Docker tidak tersedia sehingga image belum dibangun. Web UI belum dialihkan ke API agar kunci backend tidak bocor ke browser. |
| 21 September 2026 | Fase 4 selesai melalui validasi container di GitHub Actions tanpa memakai RunPod. | Image berhasil dibangun; container non-root, autentikasi, simulasi, restart/persistensi, dan Docker health check lulus pada run 35540568742. | Saldo RunPod masih $0,00. Rekomendasi berikutnya adalah autentikasi sesi `HttpOnly` dan adapter API Web UI secara lokal sambil menunggu prasyarat Fase 5. |
| 21 September 2026 | Fase 4A selesai: login `HttpOnly`, origin guard, adapter API, polling, audio server, reset, dan logout terhubung ke Web UI. | 22/22 tes Node, TypeScript, ESLint, build produksi, integrasi HTTP, serta alur browser login → sesi → pekerjaan selesai → logout lulus; CI publik tercatat pada run 35566625556. | Worker masih simulasi dan saldo RunPod $0,00. Siapkan keputusan harga, storage, image GPU, serta batas durasi sebelum Fase 5. |

## 15. Langkah pengerjaan berikutnya

**Langkah langsung:** selesaikan Fase 4B dengan build image GPU di GitHub Actions. Build hanya memeriksa base image, resolver package, import VoxCPM, UID, revision model, dan kegagalan startup tanpa CUDA; build tidak mengunduh bobot model dan tidak memakai RunPod.

Sesudah saldo tersedia, mulai Fase 5 dari pemeriksaan harga dan ketersediaan aktual, pilih batas harga serta durasi uji, lalu tentukan storage sebelum membuat Pod. Resource pertama harus dibatasi untuk satu siklus deploy → readiness → sintesis pendek → simpan hasil → penghentian terverifikasi.

Dokumen ini menjadi checklist utama. Ubah status hanya setelah hasil tersedia dan pemeriksaannya tercatat.
