# RunPod paid-cycle preflight

Preflight memeriksa kesiapan siklus GPU berbayar tanpa membuat, memulai, menghentikan, atau menghapus resource RunPod. Command hanya membaca konfigurasi lokal, permission direktori state, inventaris Pod, katalog GPU, harga, dan data center melalui REST API v2 `GET`.

```bash
npm run runpod:preflight
```

Output berupa satu objek JSON. `ok: true` berarti pemeriksaan selesai, sedangkan `readyForPaidCycle` hanya bernilai `true` jika seluruh check lulus. `safeDryRun: true` dan `mutationAttempted: false` harus selalu muncul. Rahasia, isi teks, serta audio tidak dimasukkan ke output.

Gunakan mode berikut pada deployment atau pipeline yang harus gagal bila belum siap:

```bash
npm run runpod:preflight -- --require-ready
```

Exit code `0` berarti laporan berhasil dibuat dan, pada mode `--require-ready`, semua check lulus. Exit code `2` berarti laporan valid tetapi masih mempunyai blocker. Exit code `1` berarti preflight gagal secara tak terduga.

## Check yang diwajibkan

- API key dan base URL valid, lalu inventaris serta katalog dapat dibaca tanpa mutation.
- Inventaris tidak mempunyai Pod yang belum direkonsiliasi.
- Image worker memakai digest `sha256` immutable.
- Profil GPU tersedia pada cloud yang dipilih, tarifnya tidak melewati batas per jam, dan estimasi siklus pertama tidak melewati hard cost limit.
- Data center cocok dengan profil GPU dan mendukung Network Volume; volume aktual sudah dikonfigurasi.
- Durasi uji termasuk `30`, `60`, `120`, atau `240` menit dan tidak melewati batas sesi.
- Saldo, scope key create/start/stop, satu replica, persistent state, watchdog selalu aktif, dan alert kegagalan stop telah dikonfirmasi operator.
- `VOXCPM_DATA_DIR` sudah ada sebagai direktori yang dapat dibaca dan ditulis oleh proses aplikasi.

Enam konfirmasi operator memakai nilai `true` yang eksplisit:

```dotenv
RUNPOD_WRITE_SCOPE_CONFIRMED=true
RUNPOD_BALANCE_CONFIRMED=true
RUNPOD_SINGLE_REPLICA_CONFIRMED=true
RUNPOD_PERSISTENT_STATE_CONFIRMED=true
RUNPOD_WATCHDOG_DEPLOYED=true
RUNPOD_STOP_ALERT_CONFIGURED=true
```

Nilai tersebut bukan pengganti bukti. Isi hanya setelah izin key, saldo, topology deployment, mount persisten, timer watchdog, dan jalur alert telah diperiksa. Aplikasi tidak dapat membaca saldo atau detail scope key melalui endpoint katalog yang dipakai, sehingga dua hal itu memerlukan konfirmasi operator.

## Urutan aktivasi

1. Jalankan preflight dengan `RUNPOD_WRITE_ENABLED=false` dan simpan JSON awal.
2. Selesaikan setiap blocker selain `write_gateway_enabled` sambil mempertahankan write lock.
3. Pastikan template bukti siklus pertama telah disalin dan metadata rencana terisi.
4. Aktifkan `RUNPOD_WRITE_ENABLED=true` paling akhir.
5. Jalankan `npm run runpod:preflight -- --require-ready`. Jangan mulai siklus bila exit code bukan `0` atau `readyForPaidCycle` bukan `true`.
6. Setelah pengujian, kembalikan write lock ke `false` sampai bukti dan biaya ditinjau.

Controller memakai attestation yang sama. Menyalakan `RUNPOD_WRITE_ENABLED` tanpa seluruh konfirmasi tidak membuka create, perpanjangan sesi, atau admission job baru. Stop darurat tetap tersedia ketika write gateway dan API key valid, sehingga hilangnya attestation atau konfigurasi rencana tidak menahan penghentian Pod yang sudah berjalan.
