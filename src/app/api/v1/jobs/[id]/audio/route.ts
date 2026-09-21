import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { ApiError, errorResponse, requireStudioAccess } from "@/server/http";
import { appStore } from "@/server/store";
import { validId } from "@/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = requireStudioAccess(request);
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    if (!validId(id)) throw new ApiError(400, "Invalid job ID.");
    const job = (await appStore.read()).jobs.find((item) => item.id === id);
    if (!job) throw new ApiError(404, "Job not found.");
    if (job.status !== "succeeded" || !job.outputFile) throw new ApiError(409, "Job audio is not available.");
    const audio = await readFile(appStore.outputPath(job.outputFile));
    return new NextResponse(audio, {
      headers: {
        "content-type": "audio/wav",
        "content-length": String(audio.byteLength),
        "cache-control": "private, no-store",
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(`${job.id}.wav`)}`,
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
