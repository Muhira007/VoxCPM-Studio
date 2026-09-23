# Paket worker GPU VoxCPM2

Dokumen ini mencatat paket deployment yang dapat dibangun sebelum membuat Pod berbayar. Image belum pernah menjalankan inferensi pada GPU; keberhasilan build dan pemeriksaan dependensi tidak boleh dilaporkan sebagai bukti kualitas atau keberhasilan sintesis.

## Keputusan versi

- Model: `openbmb/VoxCPM2`, snapshot `32279effe8c19989596f05d353d1447f51d9e915`.
- Library: `voxcpm==2.0.3`, rilis PyPI terbaru yang diperiksa pada 21 September 2026.
- Base image: `runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404`, image berversi dari contoh resmi RunPod.
- PyTorch: `2.8.0` dengan CUDA `12.8.1`; `torchaudio==2.8.0` dan `torchcodec==0.7.0` dipasangkan mengikuti matriks kompatibilitas TorchCodec.
- Python: 3.12 dari base image RunPod.
- Denoiser dinonaktifkan untuk percobaan pertama agar model tambahan tidak diunduh dan jalur kegagalan lebih mudah dibaca.

VoxCPM2 upstream menyebut Python 3.10–3.12, PyTorch minimal 2.5, CUDA minimal 12, audio keluaran 48 kHz, dan sekitar 8 GB VRAM. Untuk uji pertama, gunakan GPU 24 GB yang sudah ada dalam pilihan aplikasi agar ada ruang untuk CUDA context, `torch.compile`, dan variasi runtime. Nilai `WORKER_MINIMUM_VRAM_GB=8` hanya merupakan penolakan batas bawah, bukan rekomendasi kapasitas.

Rujukan utama:

- [Repository dan API VoxCPM2](https://github.com/OpenBMB/VoxCPM)
- [VoxCPM 2.0.3 di PyPI](https://pypi.org/project/voxcpm/2.0.3/)
- [Model openbmb/VoxCPM2](https://huggingface.co/openbmb/VoxCPM2)
- [Instalasi VoxCPM](https://voxcpm.readthedocs.io/en/latest/installation.html)
- [Custom Pod template RunPod](https://docs.runpod.io/pods/templates/create-custom-template)
- [Storage Pod RunPod](https://docs.runpod.io/pods/storage/types)

## Isi paket

`worker/Dockerfile.gpu` menjalankan aplikasi saja, tanpa Jupyter atau SSH. Entrypoint membuat lima direktori persisten, memberikan kepemilikan kepada UID `10001`, lalu menurunkan hak akses sebelum memulai worker.

`worker/requirements-gpu.txt` mengunci VoxCPM2, pasangan PyTorch/TorchCodec, dan seluruh dependensi langsung VoxCPM berdasarkan lock rilis upstream. Image GPU juga memakai FastAPI `0.135.1`, Starlette `0.52.1`, dan Uvicorn `0.42.0` dari lock tersebut karena Gradio `6.9.0` mensyaratkan Starlette di bawah versi `1.0`; image simulasi tetap memakai lock independennya. Docker build menjalankan `pip check` dan `preflight_gpu.py --build` untuk memastikan versi inti serta import package cocok.

Pada startup nyata, `start_gpu.py` menolak proses bila CUDA tidak terlihat, versi inti berbeda, CUDA lebih lama dari 12, atau VRAM di bawah batas. Sesudah server hidup, model dimuat pada thread latar belakang. `/health` hanya menyatakan proses hidup; `/v1/ready` melaporkan `loading`, `ready`, atau `error` dan baru mengizinkan pekerjaan ketika model siap.

Model tidak dimasukkan ke image. Snapshot yang dipin diunduh ke `/workspace/models` pada startup pertama dan digunakan kembali selama storage yang sama masih ada. Cache Hugging Face serta `torch.compile` disimpan di `/workspace/cache`.

## Kontrak inferensi

- `tts`: teks diteruskan langsung.
- `design`: deskripsi ditambahkan dalam tanda kurung di awal teks sesuai API upstream.
- `clone`: referensi terisolasi dikirim sebagai `reference_wav_path`; preset gaya diterjemahkan menjadi instruksi teks.
- `hifi`: referensi yang sama dipakai sebagai `prompt_wav_path` dan `reference_wav_path`, disertai transkrip persis sebagai `prompt_text`.

Naskah dengan dialek ekspresi `bebas-v2` dikompilasi oleh backend menjadi maksimal 50 segmen; paket lama `bebas-v1` tetap dapat diimpor. Empat delivery affiliate v2—`[warm]`, `[calm]`, `[reassuring]`, dan `[persuasive]`—diterjemahkan menjadi Control Instruction seperti tag delivery lain. Setiap segmen membawa teks target, Control Instruction, urutan, dan jeda sesudahnya; tag mentah aplikasi tidak dikirim sebagai satu naskah ke model. Worker menjalankan segmen secara berurutan. Pada cloning, seluruh segmen memakai path referensi yang sama. Hi-Fi menolak naskah ekspresif karena API mode tersebut mengabaikan kontrol gaya.

Setelah tiap segmen selesai, worker menyimpan WAV parsial dan statusnya. Seluruh WAV harus berupa PCM 16-bit dengan channel, sample rate, dan sample width yang sama. Worker menormalisasi puncak tiap segmen dengan gain maksimum 3×, menyisipkan jeda deterministik, lalu mengganti hasil gabungan secara atomik. Endpoint `POST /v1/jobs/{id}/segments/{index}/retry` membuat ulang segmen pilihan dan menggabungkan kembali bagian yang sudah ada; pembatalan serta kegagalan mempertahankan metadata hasil parsial untuk diagnosis dan retry.

Backend aplikasi mengunggah referensi ke `PUT /v1/references/{id}` sebelum membuat pekerjaan. Worker menyimpan WAV hasil secara atomik dan menyediakannya melalui `GET /v1/jobs/{id}/audio`. Backend kemudian mengunduh hasil maksimal 100 MB ke storage aplikasi dan Web UI memakai `/api/v1/jobs/{id}/audio`. Kunci worker tetap berada di server.

## Build tanpa membuat Pod

```powershell
docker build --platform linux/amd64 `
  --file worker/Dockerfile.gpu `
  --tag voxcpm-worker:gpu `
  worker
```

Build tidak mengunduh bobot model dan tidak membutuhkan GPU. Workflow `.github/workflows/worker-gpu-image.yml` menjalankan build yang sama di GitHub Actions, memeriksa package, memastikan proses turun ke UID `10001`, dan memastikan startup gagal dengan pesan yang jelas ketika runner tidak memiliki CUDA. Pemeriksaan ini lulus pada [GitHub Actions run 35568741429](https://github.com/Muhira007/VoxCPM-Studio/actions/runs/35568741429).

## Image yang diterbitkan

Workflow yang sama menerbitkan image hanya dari branch `main` setelah seluruh pemeriksaan di atas lulus. Publikasi memakai `GITHUB_TOKEN` milik workflow, bukan kredensial RunPod atau personal access token baru.

- Tag commit: `ghcr.io/muhira007/voxcpm-studio-worker:sha-215d65a8c8689c8ab2d969cc24c1704aa8e8a5b9`.
- Referensi digest yang direkomendasikan: `ghcr.io/muhira007/voxcpm-studio-worker@sha256:763938c78e0d1be4ccb968ab6dd7a351b6a14be5b7f8001e7c04540df7df6071`.
- Paket: [voxcpm-studio-worker di GHCR](https://github.com/users/Muhira007/packages/container/package/voxcpm-studio-worker).
- Workflow: [run 35856643949](https://github.com/Muhira007/VoxCPM-Studio/actions/runs/35856643949).

Paket bersifat publik dan tertaut ke repository sumber. Registry API mengembalikan HTTP `200` untuk manifest melalui tag maupun digest tanpa kredensial GitHub. Workflow menolak publikasi bila tag commit sudah ada dan tidak membuat tag `latest`; template deployment tetap harus memakai digest sebagai identitas artefak yang sebenarnya.

## Konfigurasi template RunPod nanti

Gunakan image registry dengan tag versi atau digest, bukan `latest`. Konfigurasi awal:

| Pengaturan | Nilai awal |
| --- | --- |
| Container image | `ghcr.io/muhira007/voxcpm-studio-worker@sha256:763938c78e0d1be4ccb968ab6dd7a351b6a14be5b7f8001e7c04540df7df6071` |
| Container disk | Sedikitnya 20 GB untuk image dan temporary files |
| Volume mount | `/workspace` |
| Volume | Sedikitnya 30 GB untuk model, cache, referensi, dan hasil awal |
| HTTP port | `8001` |
| `WORKER_API_KEY` | Secret acak minimal 32 karakter |
| `WORKER_MODE` | `voxcpm2` |
| `WORKER_MODEL_LOCAL_ONLY` | `false` pada startup pertama; dapat menjadi `true` setelah cache diverifikasi |

Gunakan Network Volume bila hasil harus bertahan setelah Pod dihapus. Volume disk di `/workspace` bertahan ketika Pod berhenti tetapi hilang ketika Pod diterminasi. Jangan membuka port worker tanpa kunci, dan jangan menaruh `WORKER_API_KEY` di browser atau repository.

## Validasi yang masih membutuhkan saldo

Satu pengujian GPU terkontrol harus membuktikan: CUDA terlihat, snapshot yang dipin selesai dimuat, readiness menjadi `ready`, TTS Indonesia pendek menghasilkan WAV 48 kHz, cloning membaca referensi hasil unggahan, naskah ekspresif mempertahankan identitas suara dan transisi yang layak, retry mengganti satu segmen, output dapat diunduh backend, cache dipakai ulang setelah restart, dan Pod berhenti dengan status RunPod yang sudah diverifikasi. Catat cold start, waktu sintesis per segmen, VRAM puncak, ukuran storage, dan biaya aktual.
