import { NextResponse } from "next/server";
import { ApiError, errorResponse, requireStudioAccess } from "@/server/http";
import { mergeWorkerSegments, publicJob } from "@/server/services";
import { appStore } from "@/server/store";
import { runpodController } from "@/server/runpod-controller";
import { validId } from "@/server/validation";
import { retryWorkerSegment } from "@/server/worker-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; index: string }> },
) {
  const unauthorized = requireStudioAccess(request);
  if (unauthorized) return unauthorized;
  try {
    const { id, index: rawIndex } = await context.params;
    if (!validId(id)) throw new ApiError(400, "Invalid job ID.");
    const index = Number(rawIndex);
    if (!Number.isInteger(index) || index < 0 || index >= 50)
      throw new ApiError(400, "Invalid segment index.");
    const local = (await appStore.read()).jobs.find((item) => item.id === id);
    if (!local) throw new ApiError(404, "Job not found.");
    if (!local.segments.some((segment) => segment.index === index))
      throw new ApiError(404, "Segment not found.");
    if (
      (await appStore.read()).jobs.some(
        (job) =>
          job.id !== id &&
          (job.status === "queued" || job.status === "running"),
      )
    )
      throw new ApiError(409, "Another job is active.");
    await runpodController.assertJobAdmission();
    const worker = await retryWorkerSegment(id, index);
    const updated = await appStore.updateJob(id, {
      status: worker.status,
      progress: worker.progress,
      message: worker.message || "Segment retry queued.",
      updatedAt: new Date().toISOString(),
      outputFile: null,
      audioDuration: null,
      segments: mergeWorkerSegments(local.segments, worker.segments),
    });
    await runpodController.observeWorkloadBestEffort();
    return NextResponse.json({ job: publicJob(updated!) }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
