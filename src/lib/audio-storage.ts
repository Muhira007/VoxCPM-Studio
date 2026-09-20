const DATABASE = "voxcpm-audio-v1";
const STORE = "references";
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new Error("Penyimpanan audio lokal tidak dapat dibuka."));
    request.onblocked = () =>
      reject(new Error("Tutup tab studio lain lalu coba lagi."));
  });
}
async function transaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = action(tx.objectStore(STORE));
    tx.oncomplete = () => {
      db.close();
      resolve(request.result);
    };
    tx.onerror = () => {
      db.close();
      reject(
        new Error(
          "Penyimpanan audio gagal. Periksa ruang penyimpanan browser.",
        ),
      );
    };
    tx.onabort = () => {
      db.close();
      reject(new Error("Penyimpanan audio dibatalkan."));
    };
  });
}
export async function saveAudio(id: string, file: Blob) {
  await transaction("readwrite", (store) => store.put(file, id));
}
export async function readAudio(id: string): Promise<Blob | undefined> {
  return transaction("readonly", (store) => store.get(id));
}
export async function removeAudio(id: string) {
  await transaction("readwrite", (store) => store.delete(id));
}
export async function clearAudio() {
  await transaction("readwrite", (store) => store.clear());
}

export async function inspectAudio(file: File): Promise<number> {
  if (!/\.(wav|mp3|flac|m4a|ogg|webm)$/i.test(file.name))
    throw new Error("Gunakan berkas WAV, MP3, FLAC, M4A, OGG, atau WebM.");
  if (!file.size || file.size > 20 * 1024 * 1024)
    throw new Error("Ukuran berkas harus lebih dari 0 dan maksimal 20 MB.");
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    function clean() {
      clearTimeout(timer);
      audio.onloadedmetadata = null;
      audio.onerror = null;
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(url);
    }
    audio.onloadedmetadata = () => {
      const duration = audio.duration;
      clean();
      if (!Number.isFinite(duration) || duration <= 0 || duration > 300)
        reject(
          new Error(
            "Pilih audio dengan durasi valid, maksimal 5 menit. Referensi 5–30 detik disarankan.",
          ),
        );
      else resolve(duration);
    };
    audio.onerror = () => {
      clean();
      reject(
        new Error(
          "Audio tidak dapat dibaca browser. Coba format WAV atau MP3.",
        ),
      );
    };
    const timer = setTimeout(() => {
      clean();
      reject(new Error("Audio terlalu lama dibaca. Coba berkas lain."));
    }, 10000);
    audio.preload = "metadata";
    audio.src = url;
  });
}
