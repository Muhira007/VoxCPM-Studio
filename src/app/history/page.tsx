import type { Metadata } from "next";
import { HistoryPage } from "@/components/history-page";
export const metadata: Metadata = { title: "Riwayat" };
export default function Page() {
  return <HistoryPage />;
}
