import { NextResponse } from "next/server";
import type { RunpodPlanInput } from "@/lib/runpod-types";
import { validateRunpodReadConfiguration } from "@/server/config";
import {
  ApiError,
  errorResponse,
  readJson,
  requireStudioAccess,
} from "@/server/http";
import { runpodClient } from "@/server/runpod-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parsePlanInput(value: unknown): RunpodPlanInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ApiError(422, "RunPod dry-run input must be an object.");
  const input = value as Record<string, unknown>;
  const allowed = new Set([
    "profileId",
    "cloud",
    "durationMinutes",
    "maximumHourlyRate",
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key)))
    throw new ApiError(
      422,
      "RunPod dry-run input contains an unsupported field.",
    );
  const profileId = String(input.profileId);
  const cloud = String(input.cloud);
  const durationMinutes = Number(input.durationMinutes);
  const maximumHourlyRate = Number(input.maximumHourlyRate);
  if (
    !["a5000", "3090", "4090"].includes(profileId) ||
    !["community", "secure"].includes(cloud) ||
    ![30, 60, 120, 240].includes(durationMinutes) ||
    !Number.isFinite(maximumHourlyRate) ||
    maximumHourlyRate < 0.01 ||
    maximumHourlyRate > 10
  )
    throw new ApiError(422, "RunPod dry-run input is invalid.");
  return {
    profileId,
    cloud,
    durationMinutes,
    maximumHourlyRate,
  } as RunpodPlanInput;
}

export async function POST(request: Request) {
  const unauthorized = requireStudioAccess(request);
  if (unauthorized) return unauthorized;
  try {
    const errors = validateRunpodReadConfiguration();
    if (errors.length) throw new ApiError(503, errors[0]);
    const input = parsePlanInput(await readJson(request));
    const overview = await runpodClient.overview();
    return NextResponse.json({ plan: runpodClient.plan(overview, input) });
  } catch (error) {
    return errorResponse(error);
  }
}
