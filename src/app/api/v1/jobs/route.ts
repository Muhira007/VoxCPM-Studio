import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { ServerJob } from "@/server/contracts";
import {
  ApiError,
  errorResponse,
  readJson,
  requireStudioAccess,
} from "@/server/http";
import { enforceSessionDeadline, publicJob } from "@/server/services";
import { appStore } from "@/server/store";
import { runpodController } from "@/server/runpod-controller";
import {
  parseSynthesisRequest,
  requestHash,
  validId,
} from "@/server/validation";
import { submitWorkerJob, uploadWorkerReference } from "@/server/worker-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = requireStudioAccess(request);
  if (unauthorized) return unauthorized;
  try {
    await enforceSessionDeadline();
    const state = await appStore.read();
    return NextResponse.json({ jobs: state.jobs.map(publicJob) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const unauthorized = requireStudioAccess(request);
  if (unauthorized) return unauthorized;
  try {
    await enforceSessionDeadline();
    const idempotencyKey = request.headers.get("idempotency-key") || "";
    if (!validId(idempotencyKey))
      throw new ApiError(
        422,
        "Idempotency-Key must contain 8–100 letters, numbers, underscores, or hyphens.",
      );
    const synthesis = parseSynthesisRequest(await readJson(request));
    const digest = requestHash(synthesis);
    const scenario = request.headers.get("x-demo-scenario") || "normal";
    if (!["normal", "failure", "slow"].includes(scenario))
      throw new ApiError(422, "x-demo-scenario is invalid.");
    const existing = (await appStore.read()).jobs.find(
      (job) => job.idempotencyKey === idempotencyKey,
    );
    if (existing) {
      if (existing.requestHash !== digest)
        throw new ApiError(
          409,
          "Idempotency-Key was already used with different content.",
        );
      return NextResponse.json({ job: publicJob(existing), created: false });
    }
    await runpodController.assertJobAdmission();
    const selection = await appStore.mutate((state) => {
      const existing = state.jobs.find(
        (job) => job.idempotencyKey === idempotencyKey,
      );
      if (existing) {
        if (existing.requestHash !== digest)
          throw new ApiError(
            409,
            "Idempotency-Key was already used with different content.",
          );
        return {
          job: structuredClone(existing),
          created: false,
          referencePath: null as string | null,
          referenceId: null as string | null,
        };
      }
      if (state.session.status !== "ready")
        throw new ApiError(
          409,
          "Start a ready local worker session before creating a job.",
        );
      if (
        state.jobs.some(
          (job) => job.status === "queued" || job.status === "running",
        )
      )
        throw new ApiError(
          409,
          "The single-worker queue already has an active job.",
        );
      const voice =
        synthesis.mode === "clone" || synthesis.mode === "hifi"
          ? state.voices.find((item) => item.id === synthesis.voiceId)
          : undefined;
      if ((synthesis.mode === "clone" || synthesis.mode === "hifi") && !voice)
        throw new ApiError(
          422,
          "The selected reference voice does not exist on the application server.",
        );
      const now = new Date().toISOString();
      const job: ServerJob = {
        id: `job_${randomUUID().replaceAll("-", "")}`,
        idempotencyKey,
        requestHash: digest,
        request: synthesis,
        voiceName:
          voice?.name ??
          (synthesis.mode === "design"
            ? "Voice Design"
            : "Built-in voice contract"),
        status: "queued",
        progress: 0,
        createdAt: now,
        updatedAt: now,
        message: "Queued for the configured worker.",
        outputFile: null,
        audioDuration: null,
      };
      state.jobs.unshift(job);
      return {
        job: structuredClone(job),
        created: true,
        referencePath: voice ? appStore.referencePath(voice.storageName) : null,
        referenceId: voice?.id ?? null,
      };
    });
    if (!selection.created)
      return NextResponse.json({
        job: publicJob(selection.job),
        created: false,
      });
    try {
      const workerReferencePath =
        selection.referencePath && selection.referenceId
          ? await uploadWorkerReference(
              selection.referenceId,
              selection.referencePath,
            )
          : null;
      const worker = await submitWorkerJob({
        job_id: selection.job.id,
        text: synthesis.text,
        mode: synthesis.mode,
        voice_id: synthesis.voiceId,
        description: synthesis.description,
        transcript: synthesis.transcript,
        style: synthesis.style,
        reference_path: workerReferencePath,
        scenario,
      });
      const updated = await appStore.updateJob(selection.job.id, {
        status: worker.status,
        progress: worker.progress,
        message: worker.message || selection.job.message,
        updatedAt: new Date().toISOString(),
      });
      return NextResponse.json(
        { job: publicJob(updated!), created: true },
        { status: 202 },
      );
    } catch (error) {
      await appStore.updateJob(selection.job.id, {
        status: "failed",
        message:
          error instanceof Error ? error.message : "Worker submission failed.",
        updatedAt: new Date().toISOString(),
      });
      throw error;
    }
  } catch (error) {
    return errorResponse(error);
  }
}
