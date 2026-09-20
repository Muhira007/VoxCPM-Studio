import { resolve } from "node:path";

const projectRoot = process.cwd();

export const serverConfig = {
  dataDir: resolve(/* turbopackIgnore: true */ projectRoot, process.env.VOXCPM_DATA_DIR || ".data"),
  workerUrl: (process.env.WORKER_URL || "").replace(/\/$/, ""),
  workerApiKey: process.env.WORKER_API_KEY || "",
  studioApiKey: process.env.STUDIO_API_KEY || "",
};

export function validateServerConfiguration(): string[] {
  const errors: string[] = [];
  if (serverConfig.studioApiKey.length < 32) errors.push("STUDIO_API_KEY must contain at least 32 characters.");
  if (serverConfig.workerApiKey.length < 32) errors.push("WORKER_API_KEY must contain at least 32 characters.");
  if (!/^https?:\/\//.test(serverConfig.workerUrl)) errors.push("WORKER_URL must be an HTTP(S) URL.");
  return errors;
}
