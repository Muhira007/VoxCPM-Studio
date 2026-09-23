# Kontrak paket naskah BEBAS v1

VoxCPM Studio mengimpor naskah dari Script Generator BEBAS melalui berkas JSON UTF-8. Kontrak versi pertama berbentuk:

```json
{
  "schema": "voxcpm-studio-script",
  "version": 1,
  "expressionDialect": "bebas-v1",
  "script": "[excited] Jangan checkout dulu! [curious] Sudah cek detailnya?",
  "caption": "Produk menarik untuk konten affiliate. #rekomendasi"
}
```

`script` adalah naskah voice-over dan dibatasi 5.000 karakter serta 50 segmen. Isinya boleh polos atau memakai 11 tag `bebas-v1`. `caption` adalah caption postingan dari BEBAS, boleh kosong, dan tidak ikut dibacakan oleh VoxCPM Studio. Field ini dibatasi 20.000 karakter agar kontrak tetap dapat membawa caption dan hashtag yang sudah dibuat BEBAS.

Importer hanya menerima `schema`, `version`, dan `expressionDialect` yang dikenal. JSON dibatasi 64 KB, tag ekspresi divalidasi sebelum draft diganti, dan berkas yang salah tidak mengubah naskah yang sedang diedit. Field tambahan boleh diabaikan agar produsen paket dapat menambah metadata tanpa memutus kompatibilitas v1.

VoxCPM Studio tidak menghasilkan ulang naskah atau caption. BEBAS tetap menjadi sumber generator AI; Studio hanya memvalidasi dan memuat `script` untuk pipeline audio.
