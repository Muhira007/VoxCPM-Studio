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

- Tag commit: `ghcr.io/muhira007/voxcpm-studio-worker:sha-4e61b5fec9e46f359d6cad7e6cfdb7fa497d8427`.
- Referensi digest yang direkomendasikan: `ghcr.io/muhira007/voxcpm-studio-worker@sha256:90ba964343f769a428259a59ac0acd8523de82c02f4ffddd82e2e8d78d715fbd`.
- Paket: [voxcpm-studio-worker di GHCR](https://github.com/users/Muhira007/packages/container/package/voxcpm-studio-worker).
- Workflow: [run 35571278859](https://github.com/Muhira007/VoxCPM-Studio/actions/runs/35571278859).

Paket bersifat publik dan tertaut ke repository sumber. Registry API mengembalikan HTTP `200` untuk manifest melalui tag maupun digest tanpa kredensial GitHub. Workflow menolak publikasi bila tag commit sudah ada dan tidak membuat tag `latest`; template deployment tetap harus memakai digest sebagai identitas artefak yang sebenarnya.

## Konfigurasi template RunPod nanti

Gunakan image registry dengan tag versi atau digest, bukan `latest`. Konfigurasi awal:

| Pengaturan | Nilai awal |
| --- | --- |
| Container image | `ghcr.io/muhira007/voxcpm-studio-worker@sha256:90ba964343f769a428259a59ac0acd8523de82c02f4ffddd82e2e8d78d715fbd` |
| Container disk | Sedikitnya 20 GB untuk image dan temporary files |
| Volume mount | `/workspace` |
| Volume | Sedikitnya 30 GB untuk model, cache, referensi, dan hasil awal |
| HTTP port | `8001` |
| `WORKER_API_KEY` | Secret acak minimal 32 karakter |
| `WORKER_MODE` | `voxcpm2` |
| `WORKER_MODEL_LOCAL_ONLY` | `false` pada startup pertama; dapat menjadi `true` setelah cache diverifikasi |

Gunakan Network Volume bila hasil harus bertahan setelah Pod dihapus. Volume disk di `/workspace` bertahan ketika Pod berhenti tetapi hilang ketika Pod diterminasi. Jangan membuka port worker tanpa kunci, dan jangan menaruh `WORKER_API_KEY` di browser atau repository.

## Validasi yang masih membutuhkan saldo

Satu pengujian GPU terkontrol harus membuktikan: CUDA terlihat, snapshot yang dipin selesai dimuat, readiness menjadi `ready`, TTS Indonesia pendek menghasilkan WAV 48 kHz, cloning membaca referensi hasil unggahan, output dapat diunduh backend, cache dipakai ulang setelah restart, dan Pod berhenti dengan status RunPod yang sudah diverifikasi. Catat cold start, waktu sintesis, VRAM puncak, ukuran storage, dan biaya aktual.
