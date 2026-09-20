"use client";

import {
  AudioLines,
  ArrowUpRight,
  BookAudio,
  CircleHelp,
  Cpu,
  History,
  Menu,
  Settings2,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Modal, ToastProvider } from "./ui";

const nav = [
  { href: "/", label: "Studio", icon: AudioLines },
  { href: "/voices", label: "Pustaka Suara", icon: BookAudio },
  { href: "/history", label: "Riwayat", icon: History },
  { href: "/gpu", label: "Sesi GPU", icon: Cpu },
  { href: "/settings", label: "Pengaturan", icon: Settings2 },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [menu, setMenu] = useState(false);
  const [help, setHelp] = useState(false);
  return (
    <ToastProvider>
      <div className="app-layout">
        <a className="skip-link" href="#main-content">
          Lewati ke konten
        </a>
        <aside className="sidebar">
          <Link href="/" className="brand" onClick={() => setMenu(false)}>
            <span className="brand-icon">
              <AudioLines size={25} />
            </span>
            <span>
              vox<span className="brand-cpm">cpm</span>
              <small>STUDIO</small>
            </span>
          </Link>
          <div className="workspace-label">RUANG KERJA</div>
          <nav aria-label="Navigasi utama">
            {nav.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setMenu(false)}
                aria-current={pathname === href ? "page" : undefined}
                className={`nav-link ${pathname === href ? "active" : ""}`}
              >
                <Icon size={19} />
                <span>{label}</span>
                {pathname === href && <span className="nav-indicator" />}
              </Link>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="sidebar-demo">
              <span className="demo-symbol">
                <Sparkles size={18} />
              </span>
              <strong>Ruang untuk bereksperimen</strong>
              <p>Coba alur studio secara lokal, tanpa memakai saldo GPU.</p>
              <button onClick={() => setHelp(true)}>
                Tentang Mode Demo <ArrowUpRight size={15} />
              </button>
            </div>
            <button className="help-link" onClick={() => setHelp(true)}>
              <CircleHelp size={18} />
              Panduan singkat
            </button>
            <div className="profile">
              <span className="avatar">L</span>
              <div>
                <strong>Ruang pribadi</strong>
                <span>Tersimpan di perangkat ini</span>
              </div>
              <span className="online-dot" />
            </div>
          </div>
        </aside>
        <Modal
          open={menu}
          onOpenChange={setMenu}
          title="Ruang kerja"
          description="Pilih halaman VoxCPM Studio."
        >
          <nav className="mobile-nav" aria-label="Navigasi seluler">
            {nav.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setMenu(false)}
                aria-current={pathname === href ? "page" : undefined}
                className={`nav-link ${pathname === href ? "active" : ""}`}
              >
                <Icon size={19} />
                {label}
              </Link>
            ))}
          </nav>
        </Modal>
        <div className="main-column">
          <header className="topbar">
            <div className="breadcrumb">
              <button
                className="mobile-menu icon-button"
                aria-label="Buka navigasi"
                aria-expanded={menu}
                onClick={() => setMenu(!menu)}
              >
                <Menu size={22} />
              </button>
              <span>Ruang pribadi</span>
              <span className="breadcrumb-divider">/</span>
              <strong>
                {nav.find((item) => item.href === pathname)?.label ?? "Halaman"}
              </strong>
            </div>
            <div className="topbar-right">
              <span className="local-indicator">
                <span className="online-dot" />
                Lokal
              </span>
              <button className="demo-badge" onClick={() => setHelp(true)}>
                <span />
                Mode Demo
              </button>
            </div>
          </header>
          <main id="main-content" tabIndex={-1}>
            {children}
          </main>
          <footer className="app-footer">
            <span>
              <AudioLines size={14} /> VoxCPM Studio
            </span>
            <span>Ruang pribadi. Cerita tanpa batas.</span>
            <span>Pratinjau lokal · v0.1</span>
          </footer>
        </div>
        <Modal
          open={help}
          onOpenChange={setHelp}
          title="Selamat datang di Mode Demo"
          description="Kenali alur studio sebelum menghubungkan GPU."
        >
          <div className="help-steps">
            <p>
              <strong>1. Siapkan naskah dan suara.</strong> Tulis cerita, pilih
              mode, atau tambahkan rekaman referensi milikmu.
            </p>
            <p>
              <strong>2. Coba sesi GPU.</strong> Proses pemuatan dan pekerjaan
              disimulasikan. Tidak ada resource RunPod atau tagihan yang dibuat.
            </p>
            <p>
              <strong>3. Lihat riwayat.</strong> Demo mencatat alur pekerjaan,
              tetapi belum menghasilkan suara AI. Audio yang diunggah hanya
              menjadi referensi lokal.
            </p>
          </div>
          <p className="info-note">
            Draft dan referensi hanya tersedia pada browser serta perangkat ini.
            Integrasi model dan shutdown cloud akan dikerjakan di fase
            berikutnya.
          </p>
          <button
            className="button primary full"
            onClick={() => setHelp(false)}
          >
            Mulai menjelajah
          </button>
        </Modal>
      </div>
    </ToastProvider>
  );
}
