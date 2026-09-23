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
- Watchdog membaca state job aplikasi. Job `running` atau `queued` menghapus idle deadline; antrean kosong menetapkan deadline dari aktivitas terakhir. Hard deadline dievaluasi lebih dahulu dan tidak bergantung pada snapshot workload.
- Admission job ditutup lima menit sebelum hard deadline. Watchdog menandai drain, meminta cancel untuk job aktif satu kali, menyimpan jumlah permintaan yang gagal, dan tetap menjalankan hard stop pada tenggat.
- Perpanjangan 30 menit memakai operation ID, lease, dan transaksi state yang sama untuk memperbarui hard deadline. Operasi ditolak jika sesi tidak `ready`, deadline telah lewat, durasi maksimum terlampaui, atau estimasi compute melebihi hard cost limit.
- Ledger biaya persisten mengakumulasi waktu startup/loading, job aktif, idle, serta shutdown/error pada setiap transisi controller dan pembaruan workload. Status menghitung biaya per kategori, biaya compute terakumulasi, dan exposure hingga hard deadline dari tarif sesi.
- Preflight baca saja memeriksa inventaris, harga, GPU/data center, volume, image digest, batas biaya, direktori state, serta enam attestation operasional. Start, perpanjangan, dan admission job memerlukan seluruh gate; stop darurat hanya memerlukan write gateway serta API key agar pengaman tidak menghalangi penghentian Pod aktif.
- `GET/POST /api/v1/runpod/control` dilindungi autentikasi studio dan same-origin guard. Web UI hanya menampilkan status kunci dan belum menyediakan tombol mutation.

Seluruh jalur di atas telah diuji dengan fake RunPod. Key aktual masih baca saja, `RUNPOD_WRITE_ENABLED=false`, data center dan volume ID belum diisi, serta akun tetap memiliki nol Pod. Watchdog sudah tersedia sebagai `npm run runpod:watchdog`, memakai file lock lintas proses dan template timer satu menit. Pengawas belum dideploy pada layanan cloud yang selalu aktif, jadi pengujian lokal belum memenuhi jaminan shutdown ketika PC mati. Rincian operasional ada di [runbook watchdog](runpod-watchdog.md).

## Keputusan storage

Strategi awal adalah **Standard Network Volume 30 GB** yang dipasang pada `/workspace`. Dengan tarif dokumentasi `$0.07/GB/bulan`, estimasinya `$2.10/bulan`. Network Volume bertahan secara independen dari lifecycle Pod sehingga model, cache, referensi, dan output dapat dipakai kembali setelah compute dihentikan atau dibuat ulang. Biaya storage tetap berjalan ketika Pod berhenti; volume dan data center aktual baru boleh dibuat setelah saldo tersedia dan lokasi dipilih dari katalog terbaru.

Referensi: [Network Volumes](https://docs.runpod.io/storage/network-volumes), [jenis storage Pod](https://docs.runpod.io/pods/storage/types), [create Pod](https://docs.runpod.io/api-reference-v2/pods/create-a-pod), dan [transisi status Pod](https://docs.runpod.io/api-reference-v2/pods/trigger-a-pod-state-transition).

## Kepemilikan state

Next.js bertindak sebagai control plane. Storage persisten menyimpan `podId`, status yang terakhir diverifikasi, batas harga, waktu mulai, `hardDeadline`, `idleDeadline`, bucket waktu biaya, pekerjaan, lokasi referensi/hasil, jumlah retry, serta versi state. GPU worker hanya menjalankan pekerjaan dan tidak menjadi sumber kebenaran untuk tagihan atau umur Pod.

Pengawas shutdown harus berjalan pada layanan cloud yang tetap hidup ketika browser ditutup dan PC pengguna mati. Ia tidak boleh bergantung pada timer React, proses Next.js lokal, atau Pod GPU yang hendak dihentikan. Model awal memakai satu replica aplikasi dan scheduler pada persistent filesystem yang sama; multi-replica memerlukan datastore transaksional bersama.

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

Controller watchdog lokal memindai sesi yang belum terminal, membaca waktu server, lalu:

- lima menit sebelum hard deadline: tolak job baru, minta pembatalan job aktif satu kali, lalu pertahankan jadwal stop;
- pada hard deadline: jalankan stop walaupun cancel worker atau pembacaan workload gagal;
- pada idle deadline: sinkronkan job backend dan stop hanya jika antrean serta pekerjaan berjalan kosong;
- setelah permintaan stop: poll API RunPod sampai status terverifikasi berhenti;
- jika stop gagal: simpan error, retry terbatas dengan exponential backoff dan jitter, lalu tampilkan peringatan yang membutuhkan tindakan pengguna;
- perpanjangan sesi: perbarui deadline serta operation ID secara atomik sebelum UI menampilkan waktu baru.

Admission cutoff dan pembatalan sudah diimplementasikan pada control plane lokal, tetapi belum dibuktikan terhadap worker GPU. Watchdog juga masih harus dideploy pada host cloud yang selalu aktif sebelum disebut sebagai pengaman biaya operasional.

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
- Ledger saat ini merekam startup/loading, job aktif, idle, dan shutdown/error berdasarkan timestamp control plane. Bandingkan hasilnya dengan timestamp serta tagihan RunPod karena status polling dan keterlambatan jaringan dapat menghasilkan selisih.
- Rekam storage terpakai aktual setelah Network Volume dibuat agar estimasi bulanan dapat dibandingkan dengan tagihan.
