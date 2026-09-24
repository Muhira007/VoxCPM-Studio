# Rubrik evaluasi kualitas suara

Nilai setiap hasil audio dari 1 sampai 5 pada tujuh dimensi berikut. Gunakan headphone yang sama, volume dengar tetap, dan bandingkan tanpa mengetahui nama konfigurasi bila memungkinkan.

| Dimensi | 1 | 3 | 5 |
| --- | --- | --- | --- |
| Kemiripan identitas | Tidak menyerupai referensi | Karakter utama masih dikenali tetapi berubah | Sangat konsisten dengan referensi |
| Kejelasan pengucapan | Banyak kata tidak dapat dipahami | Ada beberapa kesalahan tetapi maksud jelas | Seluruh kata jelas dan tepat |
| Naturalitas | Robotik atau ritme rusak | Cukup natural dengan beberapa bagian kaku | Mengalir seperti pembicara manusia |
| Ketepatan ekspresi | Emosi salah atau tidak terasa | Arah emosi ada tetapi kurang stabil | Emosi sesuai tag dan proporsional |
| Transisi segmen | Sambungan jelas patah | Sambungan terdengar tetapi dapat diterima | Peralihan halus dan konsisten |
| Artefak dan noise | Distorsi mengganggu | Ada artefak ringan | Bersih tanpa artefak terdengar |
| Tempo dan jeda | Terlalu cepat/lambat atau jeda rusak | Mayoritas nyaman | Tempo dan jeda terasa tepat |

Catat juga durasi audio, waktu inferensi, jumlah retry, GPU, parameter, dan estimasi biaya compute. Gunakan [template CSV](../public/quality/voice-quality-evaluation-template.csv) agar hasil setiap konfigurasi dapat dibandingkan.

Satu hasil dinyatakan **layak dipakai** bila:

- tidak ada skor 1 pada kejelasan, identitas, atau artefak;
- rata-rata tujuh dimensi minimal 4,0;
- kemiripan identitas dan kejelasan masing-masing minimal 4;
- transisi setiap naskah multisegmen minimal 3;
- reviewer menandai `usable=yes` setelah mendengar seluruh hasil.

Kegagalan pada satu dimensi harus dicatat secara spesifik, misalnya kata yang salah, timestamp artefak, tag yang terlalu kuat, atau batas segmen yang terdengar. Jangan menyimpulkan tag atau model buruk hanya dari satu hasil; ulangi maksimal satu kali dengan parameter yang sama sebelum membandingkan konfigurasi lain.
