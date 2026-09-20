import type { Metadata } from "next";
import { GpuPage } from "@/components/gpu-page";
export const metadata: Metadata = { title: "Sesi GPU" };
export default function Page() {
  return <GpuPage />;
}
