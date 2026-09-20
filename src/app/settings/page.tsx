import type { Metadata } from "next";
import { SettingsPage } from "@/components/settings-page";
export const metadata: Metadata = { title: "Pengaturan" };
export default function Page() {
  return <SettingsPage />;
}
