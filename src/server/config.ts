import { resolve } from "node:path";

const projectRoot = process.cwd();

export const serverConfig = {
  dataDir: resolve(
    /* turbopackIgnore: true */ projectRoot,
    process.env.VOXCPM_DATA_DIR || ".data",
  ),
  workerUrl: (process.env.WORKER_URL || "").replace(/\/$/, ""),
  workerApiKey: process.env.WORKER_API_KEY || "",
  studioApiKey: process.env.STUDIO_API_KEY || "",
  studioAccessPassword: process.env.STUDIO_ACCESS_PASSWORD || "",
  studioSessionSecret: process.env.STUDIO_SESSION_SECRET || "",
  runpodApiKey: process.env.RUNPOD_API_KEY || "",
  runpodApiBaseUrl: (
    process.env.RUNPOD_API_BASE_URL || "https://api.runpod.io/v2"
  ).replace(/\/$/, ""),
  runpodWorkerImage:
    process.env.RUNPOD_WORKER_IMAGE ||
    "ghcr.io/muhira007/voxcpm-studio-worker@sha256:90ba964343f769a428259a59ac0acd8523de82c02f4ffddd82e2e8d78d715fbd",
};

export function validateServerConfiguration(): string[] {
  const errors: string[] = [];
  if (serverConfig.studioApiKey.length < 32)
    errors.push("STUDIO_API_KEY must contain at least 32 characters.");
  if (serverConfig.workerApiKey.length < 32)
    errors.push("WORKER_API_KEY must contain at least 32 characters.");
  if (!/^https?:\/\//.test(serverConfig.workerUrl))
    errors.push("WORKER_URL must be an HTTP(S) URL.");
  return errors;
}

export function validateWebAuthConfiguration(): string[] {
  const errors: string[] = [];
  if (serverConfig.studioAccessPassword.length < 12)
    errors.push("STUDIO_ACCESS_PASSWORD must contain at least 12 characters.");
  if (serverConfig.studioSessionSecret.length < 32)
    errors.push("STUDIO_SESSION_SECRET must contain at least 32 characters.");
  return errors;
}

export function validateRunpodReadConfiguration(): string[] {
  const errors: string[] = [];
  if (serverConfig.runpodApiKey.length < 32)
    errors.push("RUNPOD_API_KEY must contain at least 32 characters.");
  try {
    const baseUrl = new URL(serverConfig.runpodApiBaseUrl);
    if (
      baseUrl.protocol !== "https:" ||
      baseUrl.username ||
      baseUrl.password ||
      baseUrl.search ||
      baseUrl.hash
    )
      errors.push("RUNPOD_API_BASE_URL must be a plain HTTPS URL.");
  } catch {
    errors.push("RUNPOD_API_BASE_URL must be a valid URL.");
  }
  if (!/@sha256:[a-f0-9]{64}$/.test(serverConfig.runpodWorkerImage))
    errors.push("RUNPOD_WORKER_IMAGE must use an immutable sha256 digest.");
  return errors;
}
