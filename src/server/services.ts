import type { ApiSession, ServerJob } from "./contracts";
import { appStore } from "./store";
import { cancelWorkerJob } from "./worker-client";

export function publicJob(job: ServerJob) {
  return {
    id: job.id,
    request: job.request,
    voiceName: job.voiceName,
    status: job.status,
    progress: job.progress,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    message: job.message,
    outputFile: job.outputFile,
    audioDuration: job.audioDuration,
  };
}

export async function enforceSessionDeadline(): Promise<ApiSession> {
  const state = await appStore.read();
  const expires = state.session.expiresAt ? Date.parse(state.session.expiresAt) : Number.POSITIVE_INFINITY;
  if (!["loading", "ready"].includes(state.session.status) || Date.now() < expires) return state.session;
  const active = state.jobs.filter((job) => job.status === "queued" || job.status === "running");
  await Promise.allSettled(active.map((job) => cancelWorkerJob(job.id)));
  const now = new Date().toISOString();
  await appStore.mutate((current) => {
    current.jobs = current.jobs.map((job) => active.some((item) => item.id === job.id) ? { ...job, status: "cancelled", updatedAt: now, message: "Cancelled because the local session deadline was reached." } : job);
    current.session = { ...current.session, status: "off", expiresAt: null, endedAt: now, message: "Local session deadline reached. Worker cancellation was requested." };
  });
  return (await appStore.read()).session;
}

export async function stopSession(message = "Local worker session stopped."): Promise<ApiSession> {
  const state = await appStore.read();
  const active = state.jobs.filter((job) => job.status === "queued" || job.status === "running");
  await appStore.replaceSession({ ...state.session, status: "stopping", message: "Stopping local worker simulation." });
  await Promise.allSettled(active.map((job) => cancelWorkerJob(job.id)));
  const now = new Date().toISOString();
  await appStore.mutate((current) => {
    current.jobs = current.jobs.map((job) => active.some((item) => item.id === job.id) ? { ...job, status: "cancelled", updatedAt: now, message: "Cancelled because the local session stopped." } : job);
    current.session = { ...current.session, status: "off", expiresAt: null, endedAt: now, message };
  });
  return (await appStore.read()).session;
}
