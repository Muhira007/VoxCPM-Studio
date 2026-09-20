"use client";
import { ErrorMessage } from "@/components/ui";
export default function Error({ reset }: { reset: () => void }) {
  return (
    <div className="page">
      <h1>Ruang kerja belum dapat dibuka.</h1>
      <ErrorMessage>
        Terjadi masalah saat memuat halaman. Coba lagi untuk melanjutkan.
      </ErrorMessage>
      <button className="button primary" onClick={reset}>
        Coba lagi
      </button>
    </div>
  );
}
