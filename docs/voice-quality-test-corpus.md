# Korpus validasi suara Bahasa Indonesia

Korpus kanonis tersedia sebagai [JSON yang dapat diunduh](../public/quality/voice-quality-test-corpus.json). Isinya 24 naskah `id-ID` untuk menguji baseline natural, alur affiliate, event singkat, emosi, pengucapan, prosodi, konsistensi identitas, dan Hi-Fi.

Jalankan kasus dalam tiga tingkat agar siklus GPU pertama tetap terbatas:

1. **Smoke:** `ID-01`, `ID-04`, `ID-14`, `ID-18`, dan `ID-22`.
2. **Ekspresi affiliate:** `ID-02` sampai `ID-13` dan `ID-21` sampai `ID-23`.
3. **Pengucapan dan Hi-Fi:** `ID-14` sampai `ID-20` serta `ID-24`.

Gunakan satu referensi suara yang sama untuk membandingkan identitas antarhasil. Jangan mengubah naskah di tengah satu putaran evaluasi. Catat parameter, waktu inferensi, retry, dan hasil menggunakan [rubrik evaluasi](voice-quality-evaluation-rubric.md).

`expectedSeconds` adalah target perencanaan, bukan klaim durasi hasil. `expectedTags` dipakai tes kontrak untuk memastikan seluruh tag pada naskah sesuai dengan dialek `bebas-v2`. Kasus Hi-Fi sengaja tidak memakai tag karena mode tersebut tidak menerima kontrol ekspresi.
