# Rancangan kontrol RunPod dan shutdown

Dokumen ini adalah rancangan Fase 4. Tidak ada Pod, volume, API key, atau biaya RunPod yang dibuat.

## Kepemilikan state

Next.js bertindak sebagai control plane. Storage persisten menyimpan `podId`, status yang terakhir diverifikasi, batas harga, waktu mulai, `hardDeadline`, `idleDeadline`, pekerjaan, lokasi referensi/hasil, jumlah retry, serta versi state. GPU worker hanya menjalankan pekerjaan dan tidak menjadi sumber kebenaran untuk tagihan atau umur Pod.

Pengawas shutdown harus berjalan pada layanan cloud yang tetap hidup ketika browser ditutup dan PC pengguna mati. Ia tidak boleh bergantung pada timer React, proses Next.js lokal, atau Pod GPU yang hendak dihentikan.

## State machine

```text
off → provisioning → loading_model → ready → stopping → off
             ↘ error ↗          ↘ error ↗

job: queued → running → succeeded
       ↘ cancelled  ↘ failed
```

Status Pod hidup dan worker siap harus diperiksa terpisah. `ready` hanya boleh ditulis sesudah endpoint readiness worker menjawab dan mount persisten lulus pemeriksaan tulis.

## Mulai atau pulihkan sesi

1. Ambil lock/lease dengan versi state agar dua klik atau dua pengawas tidak membuat Pod ganda.
2. Periksa sesi aktif yang tersimpan sebelum memanggil RunPod.
3. Validasi profil GPU, harga aktual, region yang mendukung volume, image, dan batas harga pengguna.
4. Buat atau resume satu Pod; simpan `podId` sebelum polling panjang.
5. Poll status infrastruktur dengan timeout serta backoff terbatas.
6. Periksa `/health`, lalu `/v1/ready`. Jangan menyamakan kedua hasil.
7. Simpan deadline absolut di cloud. Browser hanya menampilkan salinannya.

Setiap operasi memakai operation/idempotency ID. Retry dengan ID sama harus membaca hasil lama atau melanjutkan operasi; tidak boleh membuat Pod atau pekerjaan kedua.

## Hard deadline dan idle shutdown

Pengawas cloud memindai sesi yang belum terminal. Ia memperoleh lease singkat per sesi, membaca waktu server, lalu:

- pada hard deadline: berhenti menerima pekerjaan baru, minta pembatalan pekerjaan aktif, lalu jalankan stop;
- pada idle deadline: stop hanya jika antrean kosong dan worker memastikan tidak ada pekerjaan berjalan;
- setelah permintaan stop: poll API RunPod sampai status terverifikasi berhenti;
- jika stop gagal: simpan error, retry terbatas dengan exponential backoff dan jitter, lalu tampilkan peringatan yang membutuhkan tindakan pengguna;
- perpanjangan sesi: transaksi harus memperbarui deadline cloud sebelum UI menampilkan waktu baru.

Timer habis bukan bukti biaya berhenti. Hanya status RunPod yang diverifikasi dan dicatat bersama timestamp yang menutup sesi.

## Stop, terminate, dan storage

Implementasi harus membaca ulang semantik RunPod yang berlaku pada saat integrasi. Jangan menganggap stop, terminate, dan menghapus volume setara.

Sebelum terminate:

1. pastikan model/cache berada pada mount persisten yang dimaksud;
2. pastikan referensi dan output berada di storage persisten di luar filesystem sementara Pod;
3. baca kembali salah satu hasil dari proses baru;
4. simpan manifest file beserta checksum dan metadata pekerjaan;
5. baru izinkan operasi yang menghapus compute.

Worker saat ini menolak startup jika direktori data/model/cache/referensi/output tidak dapat dibuat dan ditulis. Di RunPod, mount final harus dibandingkan dengan path tersebut sebelum readiness menjadi `true`.

## Keamanan dan observabilitas

- API key RunPod hanya berada di control plane backend.
- Worker memakai kunci berbeda, jaringan terbatas, dan TLS/reverse proxy pada deployment.
- Log menyertakan operation ID, session ID, job ID, transisi status, latency, dan hasil stop tanpa mencatat kunci, teks sensitif, atau isi audio.
- Endpoint pengelolaan sesi memerlukan autentikasi pengguna; CORS tidak dipakai sebagai autentikasi.
- Batasi ukuran body, jenis audio, timeout jaringan, jumlah retry, dan satu pekerjaan aktif untuk MVP.
- Rekam waktu provisioning, model load, running, idle, stop request, stop confirmed, serta storage terpakai agar estimasi biaya dapat dibandingkan dengan tagihan.
