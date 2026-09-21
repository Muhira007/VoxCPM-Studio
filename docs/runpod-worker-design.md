# Rancangan kontrol RunPod dan shutdown

Dokumen ini berawal sebagai rancangan Fase 4 dan diperbarui pada persiapan Fase 5. Satu API key `Restricted` khusus proyek sudah dibuat dengan GraphQL `Read only` dan `api.runpod.ai` `None`, disimpan hanya pada `.env.local`, lalu diverifikasi melalui query baca REST API v2. Tidak ada Pod, volume, mutation, atau biaya RunPod yang dibuat.

Integrasi baru harus memakai REST API v2 di `https://api.runpod.io/v2` dengan header `Authorization: Bearer <key>`. GraphQL hanya dipakai sekali untuk verifikasi kompatibilitas key dan tidak menjadi dasar implementasi karena dokumentasi RunPod menyatakan GraphQL akan dihentikan pada awal 2027. Naikkan izin key ke tulis hanya ketika operasi create/start/stop sudah mempunyai validasi biaya, idempotensi, dan verifikasi status.

## Implementasi baca saja dan dry-run

Tahap baca saja sudah diimplementasikan tanpa membuat resource:

- `src/server/runpod-client.ts` hanya mengirim `GET` ke REST API v2, memakai bearer header di server, timeout 15 detik, pagination inventaris, sanitasi error, dan cache snapshot 30 detik.
- `GET /api/v1/runpod/overview` membaca seluruh Pod, katalog Community dan Secure yang memenuhi minimum CUDA 12.8, serta katalog data center. Endpoint memerlukan autentikasi studio.
- `POST /api/v1/runpod/plan` adalah perhitungan lokal terautentikasi. Method `POST` hanya membawa input UI ke backend; client RunPod tetap hanya mengirim `GET` dan respons selalu menandai `resourceCreated: false` serta `mutationAttempted: false`.
- Planner membandingkan tarif aktual dengan batas pengguna, ketersediaan, data center, inventaris Pod, image digest, container disk 20 GB, dan volume persisten awal 30 GB. Storage yang belum dipilih dan key baca saja selalu menjadi blocker.
- Panel Sesi GPU menampilkan sumber, waktu snapshot, inventaris, harga, ketersediaan, pilihan Community/Secure, dan estimasi compute. Kontrol sesi yang sudah ada tetap diberi label simulasi lokal.

Verifikasi langsung pada 21 September 2026 menghasilkan `0` Pod, `48` tipe GPU yang lolos filter katalog, dan `33` data center. Harga yang terbaca untuk Community adalah A5000 `$0.16`, RTX 3090 `$0.22`, dan RTX 4090 `$0.34` per jam; Secure adalah `$0.27`, `$0.50`, dan `$0.74`. Ketersediaan berubah antar-snapshot, sehingga semua angka di UI diberi timestamp dan harus dibaca ulang tepat sebelum operasi berbayar. Saldo tidak diklaim oleh client karena endpoint yang dipakai tidak menyediakannya.

## Implementasi control plane yang tetap terkunci

Kerangka operasi tulis sudah diimplementasikan dan diuji tanpa akun berbayar:

- `src/server/runpod-control-gateway.ts` adalah satu-satunya gateway create/start/stop. Setiap method mutation menolak dengan HTTP 423 sebelum `fetch` ketika `RUNPOD_WRITE_ENABLED` bukan `true`. Gateway tidak mempunyai operasi terminate.
- `src/server/runpod-controller.ts` menyimpan operation ID, hash input, lease, Pod ID, `mutationAttemptedAt`, deadline absolut, retry, dan status verifikasi di `.data/runpod-control.json`. Retry start merekonsiliasi nama Pod deterministik; hasil create yang timeout tidak dikirim ulang sampai Pod ditemukan atau operator menyelesaikan rekonsiliasi.
- Create memerlukan image digest, satu GPU, minimum CUDA 12.8, container disk 20 GB, serta Standard Network Volume di `/workspace`. Ia memeriksa cloud, data center, ketersediaan, batas harga UI, dan hard cost limit sebelum mutation.
- Resume hanya memakai satu Pod terkelola yang cocok dengan image immutable. Pod akun lain atau lebih dari satu Pod terkelola menghentikan operasi untuk pemeriksaan manual.
- Stop dibedakan dari terminate. Sesi baru dianggap berhenti setelah RunPod melaporkan `EXITED` atau `TERMINATED`; respons stop yang masih aktif menghasilkan backoff dan retry terbatas.
- `GET/POST /api/v1/runpod/control` dilindungi autentikasi studio dan same-origin guard. Web UI hanya menampilkan status kunci dan belum menyediakan tombol mutation.

Seluruh jalur di atas telah diuji dengan fake RunPod. Key aktual masih baca saja, `RUNPOD_WRITE_ENABLED=false`, data center dan volume ID belum diisi, serta akun tetap memiliki nol Pod. Pengawas deadline belum dideploy pada layanan cloud yang selalu aktif, jadi pengujian lokal belum memenuhi jaminan shutdown ketika PC mati.

## Keputusan storage

Strategi awal adalah **Standard Network Volume 30 GB** yang dipasang pada `/workspace`. Dengan tarif dokumentasi `$0.07/GB/bulan`, estimasinya `$2.10/bulan`. Network Volume bertahan secara independen dari lifecycle Pod sehingga model, cache, referensi, dan output dapat dipakai kembali setelah compute dihentikan atau dibuat ulang. Biaya storage tetap berjalan ketika Pod berhenti; volume dan data center aktual baru boleh dibuat setelah saldo tersedia dan lokasi dipilih dari katalog terbaru.

Referensi: [Network Volumes](https://docs.runpod.io/storage/network-volumes), [jenis storage Pod](https://docs.runpod.io/pods/storage/types), [create Pod](https://docs.runpod.io/api-reference-v2/pods/create-a-pod), dan [transisi status Pod](https://docs.runpod.io/api-reference-v2/pods/trigger-a-pod-state-transition).

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

- API key RunPod hanya berada di control plane backend. Konfigurasi lokal memakai `.env.local`, yang diabaikan Git; nama variabel tidak boleh diawali `NEXT_PUBLIC_`.
- Worker memakai kunci berbeda, jaringan terbatas, dan TLS/reverse proxy pada deployment.
- Log menyertakan operation ID, session ID, job ID, transisi status, latency, dan hasil stop tanpa mencatat kunci, teks sensitif, atau isi audio.
- Endpoint pengelolaan sesi memerlukan autentikasi pengguna; CORS tidak dipakai sebagai autentikasi.
- Batasi ukuran body, jenis audio, timeout jaringan, jumlah retry, dan satu pekerjaan aktif untuk MVP.
- Rekam waktu provisioning, model load, running, idle, stop request, stop confirmed, serta storage terpakai agar estimasi biaya dapat dibandingkan dengan tagihan.
