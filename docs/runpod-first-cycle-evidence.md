# Bukti siklus GPU RunPod pertama

Salin dokumen ini untuk setiap siklus berbayar. Jangan menulis API key, worker key, kata sandi, teks pengguna, atau isi audio ke dalam bukti.

## Identitas pengujian

- Tanggal dan zona waktu:
- Operator:
- Commit aplikasi:
- Digest image worker:
- Profile GPU dan cloud:
- Data center:
- Network Volume: ID disamarkan, empat karakter terakhir saja
- Durasi rencana:
- Batas harga per jam:
- Hard cost limit:

## Gate sebelum operasi

- Path artefak JSON preflight:
- Waktu observasi katalog:
- `readyForPaidCycle: true`:
- `mutationAttempted: false`:
- Jumlah Pod sebelum mulai: `0`
- Saldo awal yang dilihat operator:
- Timer watchdog aktif dan eksekusi terakhir sukses:
- Alert stop diuji:
- Satu replica dan persistent `VOXCPM_DATA_DIR` dikonfirmasi:

Jika salah satu baris belum terbukti, jangan aktifkan operasi tulis.

## Timeline siklus

| Peristiwa               | Timestamp UTC | Bukti atau catatan |
| ----------------------- | ------------- | ------------------ |
| Request create/start    |               |                    |
| Pod provisioning        |               |                    |
| Worker loading model    |               |                    |
| Worker ready            |               |                    |
| Job sintesis dikirim    |               |                    |
| Job selesai             |               |                    |
| Output tersimpan        |               |                    |
| Request stop            |               |                    |
| Status terminal terbaca |               |                    |

## Validasi fungsi

- Mode sintesis yang diuji:
- Naskah uji non-sensitif:
- Referensi audio uji:
- Job ID disamarkan:
- Output dapat diputar:
- Output tetap tersedia setelah Pod berhenti:
- Pod baru dapat memakai kembali model/cache dan output dari volume:
- Temuan kualitas atau error:

## Penghentian dan pemulihan

- Alasan stop:
- `stopConfirmedAt`:
- Status RunPod terminal (`EXITED` atau `TERMINATED`):
- Browser ditutup saat uji watchdog:
- PC operator dimatikan atau dilepas dari jaringan saat uji watchdog:
- Watchdog cloud tetap menjalankan stop:
- Retry atau alert yang terjadi:
- Jumlah Pod setelah selesai: `0` aktif
- `RUNPOD_WRITE_ENABLED` dikembalikan ke `false`:

## Rekonsiliasi biaya

| Komponen                 | Ledger aplikasi | Timestamp/tagihan RunPod | Selisih | Catatan |
| ------------------------ | --------------- | ------------------------ | ------- | ------- |
| Startup/loading          |                 |                          |         |         |
| Job aktif                |                 |                          |         |         |
| Idle                     |                 |                          |         |         |
| Shutdown/error           |                 |                          |         |         |
| Total compute            |                 |                          |         |         |
| Network Volume per bulan |                 |                          |         |         |

- Saldo akhir:
- Biaya compute aktual:
- Biaya storage aktual:
- Penyebab selisih ledger:
- Perlu mengubah cutoff, timeout, atau hard cost limit:

## Keputusan

- Hasil: lulus / gagal / perlu diulang
- Blocker yang tersisa:
- Insiden atau cleanup manual:
- Perubahan yang diperlukan sebelum siklus berikutnya:
- Peninjau dan tanggal:
