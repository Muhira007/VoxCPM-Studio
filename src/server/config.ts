import { resolve } from "node:path";

const projectRoot = process.cwd();

export const serverConfig = {
  dataDir: resolve(/* turbopackIgnore: true */ projectRoot, process.env.VOXCPM_DATA_DIR || ".data"),
  workerUrl: (process.env.WORKER_URL || "").replace(/\/$/, ""),
  workerApiKey: process.env.WORKER_API_KEY || "",
  studioApiKey: process.env.STUDIO_API_KEY || "",
  studioAccessPassword: process.env.STUDIO_ACCESS_PASSWORD || "",
  studioSessionSecret: process.env.STUDIO_SESSION_SECRET || "",
};

export function validateServerConfiguration(): string[] {
  const errors: string[] = [];
  if (serverConfig.studioApiKey.length < 32) errors.push("STUDIO_API_KEY must contain at least 32 characters.");
  if (serverConfig.workerApiKey.length < 32) errors.push("WORKER_API_KEY must contain at least 32 characters.");
  if (!/^https?:\/\//.test(serverConfig.workerUrl)) errors.push("WORKER_URL must be an HTTP(S) URL.");
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
