# Panduan rekaman referensi voice cloning

## Target teknis

- Rekam satu orang dalam ruangan tenang, tanpa musik, efek, atau suara lain.
- Jaga jarak mikrofon sekitar 10–20 cm dan posisi tetap selama membaca.
- Targetkan WAV PCM mono, minimal 24 kHz, dengan durasi 15–60 detik.
- MP3, FLAC, M4A, OGG, dan WebM tetap dapat diperiksa, tetapi WAV menghindari kompresi lossy dan perbedaan decoder.
- Sisakan headroom. Jangan menormalisasi sampai 0 dBFS dan hindari noise reduction agresif yang membuat suara berair atau metalik.
- Potong keheningan panjang di awal dan akhir, tetapi jangan memotong napas atau awal konsonan.

Pemeriksa lokal mengukur format, durasi, sample rate, channel, RMS, puncak, clipping, serta keheningan awal/akhir. Status **Siap diuji** hanya berarti berkas lolos pemeriksaan teknis; kemiripan dan naturalitas tetap harus dinilai dari hasil VoxCPM pada GPU.

## Teks rekaman

> Hari ini saya merekam suara dengan jelas dan santai. Saya menjaga jarak dari mikrofon, berbicara dengan volume yang stabil, dan memberi jeda alami di antara kalimat. Harga produk ini seratus dua puluh sembilan ribu rupiah. Promo berlaku sampai tanggal dua puluh lima Desember. Jika kualitasnya sesuai kebutuhan, kita dapat melanjutkan ke tahap berikutnya dengan tenang dan percaya diri.

Gunakan intonasi natural. Jangan membaca tag ekspresi. Untuk Hi-Fi cloning, transkrip harus sama persis dengan ucapan pada rekaman, termasuk kata, angka yang dibaca, pengulangan, dan kesalahan yang memang terdengar.

## Sampel pengguna yang diperiksa pada 24 September 2026

Lima MP3 dari folder sampel lokal yang diberikan pengguna dibaca tanpa menyalin audio ke repository. Seluruhnya MP3 192 kbps, stereo, 44,1 kHz. Level rata-rata berada pada −18,9 sampai −22,0 dBFS dan puncak pada −0,5 sampai −3,0 dBFS.

| Sampel | Durasi | RMS | Puncak | Catatan lokal |
| --- | ---: | ---: | ---: | --- |
| Sample Audio 1 | 57,81 dtk | −20,3 dBFS | −1,4 dBFS | Durasi dan level sesuai target; WAV mono tetap disarankan. |
| Sample Audio 2 | 41,12 dtk | −19,8 dBFS | −2,6 dBFS | Durasi dan level sesuai target; WAV mono tetap disarankan. |
| Sample Audio 3 | 74,08 dtk | −20,5 dBFS | −3,0 dBFS | Level baik; potong bagian terbaik menjadi 15–60 detik. |
| Sample Audio 4 | 52,66 dtk | −18,9 dBFS | −1,8 dBFS | Durasi dan level sesuai target; WAV mono tetap disarankan. |
| Sample Audio 5 | 112,82 dtk | −22,0 dBFS | −0,5 dBFS | Terlalu panjang untuk target dan puncak dekat batas digital. |

Pemeriksaan ini tidak menilai noise latar secara subjektif, kemiripan cloning, atau ketepatan transkrip karena belum menjalankan inferensi maupun uji dengar terstruktur.
