import { NextResponse } from "next/server";
import type { RunpodProfileId } from "@/lib/runpod-types";
import {
  ApiError,
  errorResponse,
  readJson,
  requireStudioAccess,
} from "@/server/http";
import { runpodController } from "@/server/runpod-controller";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function operationId(request: Request): string {
  const value = request.headers.get("idempotency-key") || "";
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(value))
    throw new ApiError(
      422,
      "A valid Idempotency-Key header is required for this operation.",
    );
  return value;
}

function objectInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ApiError(422, "RunPod control input must be an object.");
  return value as Record<string, unknown>;
}

export async function GET(request: Request) {
  const unauthorized = requireStudioAccess(request);
  if (unauthorized) return unauthorized;
  try {
    return NextResponse.json({ control: await runpodController.status() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const unauthorized = requireStudioAccess(request);
  if (unauthorized) return unauthorized;
  try {
    const input = objectInput(await readJson(request));
    const action = String(input.action || "");
    if (action === "reconcile") {
      if (Object.keys(input).some((key) => key !== "action"))
        throw new ApiError(
          422,
          "Reconcile input contains an unsupported field.",
        );
      return NextResponse.json({ state: await runpodController.reconcile() });
    }
    if (action === "watchdog") {
      if (Object.keys(input).some((key) => key !== "action"))
        throw new ApiError(
          422,
          "Watchdog input contains an unsupported field.",
        );
      return NextResponse.json({ state: await runpodController.runWatchdog() });
    }
    if (action === "stop") {
      if (Object.keys(input).some((key) => key !== "action"))
        throw new ApiError(422, "Stop input contains an unsupported field.");
      return NextResponse.json({
        state: await runpodController.stop({
          operationId: operationId(request),
        }),
      });
    }
    if (action === "start") {
      const allowed = new Set([
        "action",
        "profileId",
        "durationMinutes",
        "maximumHourlyRate",
      ]);
      if (Object.keys(input).some((key) => !allowed.has(key)))
        throw new ApiError(422, "Start input contains an unsupported field.");
      return NextResponse.json({
        state: await runpodController.start({
          operationId: operationId(request),
          profileId: String(input.profileId) as RunpodProfileId,
          durationMinutes: Number(input.durationMinutes),
          maximumHourlyRate: Number(input.maximumHourlyRate),
        }),
      });
    }
    throw new ApiError(422, "The RunPod control action is invalid.");
  } catch (error) {
    return errorResponse(error);
  }
}
