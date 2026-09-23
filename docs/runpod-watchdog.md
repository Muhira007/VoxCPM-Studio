# RunPod watchdog scheduler

Watchdog sudah dikemas sebagai command sekali jalan. Command membaca state persisten, memeriksa hard deadline atau retry yang sudah jatuh tempo, lalu membaca snapshot job backend untuk keputusan idle shutdown. Ia tidak membuat loop sendiri sehingga platform scheduler dapat mengatur cadence, timeout, restart, dan alert.

```bash
npm run runpod:watchdog
```

Dengan konfigurasi repository saat ini, hasilnya adalah JSON seperti berikut dan tidak ada request mutation:

```json
{ "ok": true, "action": "skipped_writes_disabled", "phase": "off" }
```

Exit code `0` berarti pemeriksaan selesai, termasuk ketika belum ada tindakan yang jatuh tempo. Exit code nonzero harus memicu alert operator. Output memuat hard/idle deadline, jumlah job running/queued, retry, alasan stop, dan `costEstimate` tanpa API key, worker key, teks pengguna, atau audio. `costEstimate` adalah perhitungan dari timestamp control plane, bukan tagihan RunPod.

## Urutan keputusan deadline

1. Hard deadline selalu diperiksa lebih dahulu dan tetap meminta stop ketika job aktif atau snapshot workload gagal.
2. Retry stop yang sudah jatuh tempo melanjutkan alasan stop sebelumnya tanpa menunggu snapshot baru.
3. Idle deadline hanya dihitung ketika fase worker `ready` serta tidak ada job `running` atau `queued`.
4. Aktivitas job terakhir, waktu mulai, dan waktu worker siap menjadi dasar idle deadline. Aktivitas baru menggeser deadline; job aktif menghapusnya.
5. Perpanjangan sesi hanya menerima tambahan 30 menit melalui `POST /api/v1/runpod/control` dengan `Idempotency-Key`. Deadline dan catatan operasi berubah dalam satu transaksi state, lalu tetap dibatasi durasi maksimum dan hard cost limit.

Lima menit sebelum hard deadline, controller memasuki drain: endpoint pembuatan job menolak pekerjaan baru, job `running`/`queued` diminta batal, dan hasil cancel disimpan sebagai jumlah yang ditandai batal serta jumlah request worker yang gagal. Drain idempoten sehingga eksekusi watchdog berikutnya tidak mengirim cancel kedua. Perpanjangan ditolak setelah drain dimulai. Saat hard deadline tercapai, kegagalan cancel tidak boleh menahan stop Pod.

Perilaku ini telah diuji dengan fake worker dan fake RunPod. Durasi cutoff lima menit adalah batas konservatif sebelum waktu inferensi aktual diukur pada GPU; nilainya harus dievaluasi ulang dari data Fase 6.

## Ledger estimasi biaya

State sesi menyimpan waktu terakumulasi untuk empat kategori: startup/loading, job aktif, idle, serta shutdown/error. Controller mengakumulasi kategori lama sebelum mengubah phase atau snapshot workload, sehingga perpindahan state tidak memasukkan interval ke bucket yang baru. Endpoint submit, polling, dan cancel job juga meminta sinkronisasi workload secara best-effort agar job yang lebih singkat dari cadence watchdog tetap tercatat tanpa membuat alur job gagal ketika observabilitas bermasalah.

Status kontrol dan output watchdog mengalikan detik pada setiap kategori dengan tarif per jam sesi. Output juga menghitung sisa exposure compute sampai hard deadline dan proyeksi compute maksimum. Estimasi Standard Network Volume 30 GB sebesar `$2.10/bulan` selalu dilaporkan terpisah; angka itu belum menjadi biaya aktual selama volume belum dibuat. Semua angka harus dibandingkan dengan invoice serta timestamp RunPod setelah siklus GPU pertama.

## Model deployment yang dipilih

Tahap pertama memakai **satu replica aplikasi** dan satu persistent filesystem untuk `VOXCPM_DATA_DIR`. Proses Next.js dan command watchdog harus membaca direktori yang sama. `RunpodControlStore` memakai exclusive file lock untuk membuat transaksi state antarproses berurutan, memulihkan lock yang tertinggal lebih dari 60 detik, dan tetap memakai lease operasi persisten selama 120 detik.

Jangan menjalankan beberapa replica dengan disk lokal masing-masing. File lock tidak dapat mengoordinasikan filesystem yang berbeda. Deployment multi-replica memerlukan datastore bersama dengan transaksi compare-and-swap sebelum operasi tulis RunPod boleh diaktifkan.

## Template systemd

Template ada di `deploy/systemd/voxcpm-runpod-watchdog.service` dan `deploy/systemd/voxcpm-runpod-watchdog.timer`. Template menjalankan command setiap menit dengan timeout 60 detik. Sesuaikan `User`, `Group`, `WorkingDirectory`, path `npm`, dan `EnvironmentFile` dengan host deployment.

Environment file harus hanya dapat dibaca oleh akun service. Aplikasi dan timer harus memakai nilai yang sama untuk `VOXCPM_DATA_DIR`, konfigurasi RunPod, dan worker key. Jangan menaruh environment file di repository.

Contoh instalasi setelah host cloud tersedia:

```bash
sudo install -m 0644 deploy/systemd/voxcpm-runpod-watchdog.service /etc/systemd/system/
sudo install -m 0644 deploy/systemd/voxcpm-runpod-watchdog.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now voxcpm-runpod-watchdog.timer
systemctl list-timers voxcpm-runpod-watchdog.timer
```

Perintah instalasi di atas belum dijalankan. Timer baru boleh diaktifkan setelah host selalu aktif tersedia, persistent directory terpasang, log/alert dipantau, dan satu replica dipastikan.

## Checklist sebelum operasi berbayar

- `npm run runpod:preflight -- --require-ready` lulus dengan `readyForPaidCycle: true` dan `mutationAttempted: false`.
- `npm run runpod:watchdog` berjalan sukses dengan `RUNPOD_WRITE_ENABLED=false`.
- Aplikasi dan timer memakai persistent `VOXCPM_DATA_DIR` yang sama.
- Hanya satu replica aplikasi yang dapat menulis state.
- API key hanya mempunyai izin create/start/stop yang dibutuhkan; terminate tetap tidak tersedia.
- Network Volume dan data center sudah cocok dengan GPU yang dipilih.
- Scheduler berjalan setiap menit dan exit code nonzero menghasilkan alert.
- Endpoint job menolak pekerjaan baru selama drain dan UI menampilkan countdown serta alasan stop.
- UI dan output watchdog menandai ledger biaya sebagai estimasi serta memisahkan compute dari storage bulanan.
- Uji terkontrol membuktikan proses berhenti ketika browser serta PC pengguna mati.

Deployment cloud dan verifikasi terakhir tetap menunggu saldo serta host yang dipilih.
