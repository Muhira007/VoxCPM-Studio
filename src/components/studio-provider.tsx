"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { DemoStudioService, STORAGE_KEY } from "@/lib/demo-service";
import type { StudioService } from "@/lib/types";
import { registerStudioTools } from "@/lib/webmcp";
import { ErrorMessage, LoadingState } from "./ui";

const StudioContext = createContext<StudioService | null>(null);
export function StudioProvider({ children }: { children: ReactNode }) {
  const [service] = useState(() => new DemoStudioService());
  useEffect(() => {
    try {
      service.hydrate(localStorage.getItem(STORAGE_KEY));
    } catch {
      service.hydrate(null);
      service.reportStorageWarning(
        "Browser tidak mengizinkan penyimpanan lokal. Perubahan mungkin hilang saat halaman ditutup.",
      );
    }
    let previous = "";
    const save = () => {
      const serialized = service.serialize();
      if (serialized === previous) return;
      previous = serialized;
      try {
        localStorage.setItem(STORAGE_KEY, serialized);
      } catch {
        service.reportStorageWarning(
          "Penyimpanan lokal penuh atau diblokir. Perubahan terbaru belum tersimpan.",
        );
      }
    };
    const unsubscribe = service.subscribe(save);
    save();
    const interval = setInterval(() => service.tick(), 1000);
    const unregisterTools = registerStudioTools(service);
    return () => {
      unregisterTools();
      clearInterval(interval);
      unsubscribe();
      service.dispose();
    };
  }, [service]);
  return (
    <StudioContext.Provider value={service}>
      <HydrationBoundary>{children}</HydrationBoundary>
    </StudioContext.Provider>
  );
}
function HydrationBoundary({ children }: { children: ReactNode }) {
  const { state } = useStudio();
  if (!state.hydrated) return <LoadingState />;
  return (
    <>
      {state.storageWarning && (
        <div className="storage-warning">
          <ErrorMessage>{state.storageWarning}</ErrorMessage>
        </div>
      )}
      {children}
    </>
  );
}
export function useStudio() {
  const service = useContext(StudioContext);
  if (!service) throw new Error("StudioProvider is required");
  const state = useSyncExternalStore(
    service.subscribe,
    service.getSnapshot,
    service.getSnapshot,
  );
  return { service, state };
}
