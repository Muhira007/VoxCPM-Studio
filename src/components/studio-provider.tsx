"use client";

import { KeyRound, LoaderCircle, LockKeyhole } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from "react";
import { API_STORAGE_KEY, ApiStudioService } from "@/lib/api-service";
import { DemoStudioService, STORAGE_KEY } from "@/lib/demo-service";
import type { StudioService } from "@/lib/types";
import { registerStudioTools } from "@/lib/webmcp";
import { ErrorMessage, LoadingState } from "./ui";

const StudioContext = createContext<StudioService | null>(null);
const API_MODE = process.env.NEXT_PUBLIC_STUDIO_SERVICE === "api";
type AuthState = "checking" | "login" | "ready" | "configuration-error";

export function StudioProvider({ children }: { children: ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>(
    API_MODE ? "checking" : "ready",
  );
  const [authError, setAuthError] = useState("");
  const [service] = useState<StudioService>(() =>
    API_MODE
      ? new ApiStudioService(() => setAuthState("login"))
      : new DemoStudioService(),
  );

  async function hydrateApi() {
    setAuthState("checking");
    setAuthError("");
    try {
      let serialized: string | null = null;
      try {
        serialized = localStorage.getItem(API_STORAGE_KEY);
      } catch {}
      await (service as ApiStudioService).hydrate(serialized);
      setAuthState("ready");
    } catch (error) {
      setAuthError(
        error instanceof Error ? error.message : "API lokal tidak dapat dimuat.",
      );
      setAuthState("login");
    }
  }

  useEffect(() => {
    if (service.mode === "demo") {
      const demo = service as DemoStudioService;
      try {
        demo.hydrate(localStorage.getItem(STORAGE_KEY));
      } catch {
        demo.hydrate(null);
        demo.reportStorageWarning(
          "Browser tidak mengizinkan penyimpanan lokal. Perubahan mungkin hilang saat halaman ditutup.",
        );
      }
      let previous = "";
      const save = () => {
        const serialized = demo.serialize();
        if (serialized === previous) return;
        previous = serialized;
        try {
          localStorage.setItem(STORAGE_KEY, serialized);
        } catch {
          demo.reportStorageWarning(
            "Penyimpanan lokal penuh atau diblokir. Perubahan terbaru belum tersimpan.",
          );
        }
      };
      const unsubscribe = demo.subscribe(save);
      save();
      const interval = setInterval(() => demo.tick(), 1000);
      const unregisterTools = registerStudioTools(demo);
      return () => {
        unregisterTools();
        clearInterval(interval);
        unsubscribe();
        demo.dispose();
      };
    }

    let disposed = false;
    const api = service as ApiStudioService;
    const interval = setInterval(() => api.tick(), 1000);
    const unregisterTools = registerStudioTools(api);
    void fetch("/api/v1/auth/session", {
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async (response) => {
        const status = (await response.json()) as {
          configured: boolean;
          authenticated: boolean;
          message?: string;
        };
        if (disposed) return;
        if (!status.configured) {
          setAuthError(
            status.message || "Web UI API belum dikonfigurasi pada server.",
          );
          setAuthState("configuration-error");
        } else if (!status.authenticated) setAuthState("login");
        else await hydrateApi();
      })
      .catch(() => {
        if (!disposed) {
          setAuthError("Endpoint autentikasi lokal tidak dapat dihubungi.");
          setAuthState("configuration-error");
        }
      });
    return () => {
      disposed = true;
      unregisterTools();
      clearInterval(interval);
      api.dispose();
    };
    // The selected adapter is fixed for the lifetime of this provider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service]);

  if (API_MODE && authState !== "ready")
    return (
      <LoginScreen
        state={authState}
        initialError={authError}
        onAuthenticated={() => void hydrateApi()}
      />
    );

  return (
    <StudioContext.Provider value={service}>
      <HydrationBoundary>{children}</HydrationBoundary>
    </StudioContext.Provider>
  );
}

function LoginScreen({
  state,
  initialError,
  onAuthenticated,
}: {
  state: AuthState;
  initialError: string;
  onAuthenticated: () => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ password }),
      });
      const payload = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;
      if (!response.ok)
        throw new Error(payload?.message || "Studio tidak dapat dibuka.");
      setPassword("");
      onAuthenticated();
    } catch (problem) {
      setError(
        problem instanceof Error ? problem.message : "Studio tidak dapat dibuka.",
      );
    } finally {
      setBusy(false);
    }
  }

  const checking = state === "checking";
  const configurationError = state === "configuration-error";
  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <span className="login-mark">
          {checking ? (
            <LoaderCircle className="spin" size={26} />
          ) : (
            <LockKeyhole size={26} />
          )}
        </span>
        <div>
          <div className="eyebrow">VOXCPM STUDIO · API LOKAL</div>
          <h1 id="login-title">
            {checking ? "Menyiapkan ruang kerja…" : "Masuk ke ruang pribadimu"}
          </h1>
          <p>
            Cookie sesi disimpan sebagai <code>HttpOnly</code>. Kunci backend
            tidak dikirim ke JavaScript browser.
          </p>
        </div>
        {!checking && (
          <form onSubmit={submit} className="form-stack">
            <label className="field-label" htmlFor="studio-password">
              Kata sandi studio
              <span className="password-field">
                <KeyRound size={17} />
                <input
                  id="studio-password"
                  type="password"
                  autoComplete="current-password"
                  minLength={12}
                  required
                  disabled={busy || configurationError}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoFocus
                />
              </span>
            </label>
            {(error || initialError) && (
              <ErrorMessage>{error || initialError}</ErrorMessage>
            )}
            <button
              className="button primary full"
              type="submit"
              disabled={busy || configurationError}
            >
              {busy && <LoaderCircle className="spin" size={16} />}
              {configurationError ? "Konfigurasi belum lengkap" : "Masuk"}
            </button>
          </form>
        )}
        <p className="login-note">
          Worker masih dalam mode simulasi. Masuk tidak membuat Pod atau biaya
          RunPod.
        </p>
      </section>
    </main>
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
