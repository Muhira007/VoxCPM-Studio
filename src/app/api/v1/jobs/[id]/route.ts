import { NextResponse } from "next/server";
import { ApiError, errorResponse, requireStudioKey } from "@/server/http";
import { enforceSessionDeadline, publicJob } from "@/server/services";
import { appStore } from "@/server/store";
import { validId } from "@/server/validation";
import { readWorkerJob } from "@/server/worker-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = requireStudioKey(request);
  if (unauthorized) return unauthorized;
  try {
    await enforceSessionDeadline();
    const { id } = await context.params;
    if (!validId(id)) throw new ApiError(400, "Invalid job ID.");
    let job = (await appStore.read()).jobs.find((item) => item.id === id);
    if (!job) throw new ApiError(404, "Job not found.");
    if (job.status === "queued" || job.status === "running") {
      const worker = await readWorkerJob(id);
      job = await appStore.updateJob(id, { status: worker.status, progress: worker.progress, message: worker.message || job.message, updatedAt: new Date().toISOString(), outputFile: null, audioDuration: null }) ?? job;
    }
    return NextResponse.json({ job: publicJob(job) });
  } catch (error) { return errorResponse(error); }
}
