import Link from "next/link";
import { AudioLines } from "lucide-react";
import { EmptyState } from "@/components/ui";
export default function NotFound() {
  return (
    <div className="page">
      <EmptyState
        icon={<AudioLines />}
        title="Halaman tidak ditemukan"
        description="Kembali ke Studio untuk melanjutkan ceritamu."
      >
        <Link className="button primary" href="/">
          Buka Studio
        </Link>
      </EmptyState>
    </div>
  );
}
