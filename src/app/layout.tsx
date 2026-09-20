import type { Metadata } from "next";
import "@fontsource-variable/geist";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { StudioProvider } from "@/components/studio-provider";

export const metadata: Metadata = {
  title: { default: "Studio — VoxCPM", template: "%s — VoxCPM Studio" },
  description:
    "Studio pribadi untuk menyiapkan naskah, referensi suara, dan sesi TTS. Pratinjau lokal tanpa GPU.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body>
        <AppShell>
          <StudioProvider>{children}</StudioProvider>
        </AppShell>
      </body>
    </html>
  );
}
