import { NextResponse } from "next/server";
import { ApiError, errorResponse, requireStudioAccess } from "@/server/http";
import { publicJob } from "@/server/services";
import { appStore } from "@/server/store";
import { runpodController } from "@/server/runpod-controller";
import { validId } from "@/server/validation";
import { cancelWorkerJob } from "@/server/worker-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const unauthorized = requireStudioAccess(request);
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    if (!validId(id)) throw new ApiError(400, "Invalid job ID.");
    const local = (await appStore.read()).jobs.find((item) => item.id === id);
    if (!local) throw new ApiError(404, "Job not found.");
    if (local.status !== "queued" && local.status !== "running")
      return NextResponse.json({ job: publicJob(local) });
    const worker = await cancelWorkerJob(id);
    const updated = await appStore.updateJob(id, {
      status: worker.status,
      progress: worker.progress,
      message: worker.message || "Job cancelled.",
      updatedAt: new Date().toISOString(),
    });
    await runpodController.observeWorkloadBestEffort();
    return NextResponse.json({ job: publicJob(updated!) });
  } catch (error) {
    return errorResponse(error);
  }
}
