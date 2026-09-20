import type { Metadata } from "next";
import { VoicesPage } from "@/components/voices-page";
export const metadata: Metadata = { title: "Pustaka Suara" };
export default function Page() {
  return <VoicesPage />;
}
