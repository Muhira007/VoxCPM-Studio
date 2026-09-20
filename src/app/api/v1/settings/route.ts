import { NextResponse } from "next/server";
import type { ServerSettings } from "@/server/contracts";
import { ApiError, errorResponse, readJson, requireStudioKey } from "@/server/http";
import { appStore } from "@/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = requireStudioKey(request);
  if (unauthorized) return unauthorized;
  try { return NextResponse.json({ settings: (await appStore.read()).settings }); }
  catch (error) { return errorResponse(error); }
}

export async function PUT(request: Request) {
  const unauthorized = requireStudioKey(request);
  if (unauthorized) return unauthorized;
  try {
    const body = await readJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError(422, "Settings must be an object.");
    const value = body as Record<string, unknown>;
    const allowed = new Set(["sessionMinutes", "idleMinutes", "maximumHourlyRate", "gpuProfile"]);
    if (Object.keys(value).some((key) => !allowed.has(key))) throw new ApiError(422, "Settings contain an unsupported field.");
    const sessionMinutes = Number(value.sessionMinutes);
    const idleMinutes = Number(value.idleMinutes);
    const maximumHourlyRate = Number(value.maximumHourlyRate);
    const gpuProfile = String(value.gpuProfile);
    if (![30, 60, 120, 240].includes(sessionMinutes) || ![5, 10, 15, 30].includes(idleMinutes) || !Number.isFinite(maximumHourlyRate) || maximumHourlyRate < 0.01 || maximumHourlyRate > 10 || !["a5000", "rtx3090", "rtx4090"].includes(gpuProfile)) throw new ApiError(422, "Settings are invalid.");
    const settings = { sessionMinutes, idleMinutes, maximumHourlyRate, gpuProfile } as ServerSettings;
    await appStore.mutate((state) => { state.settings = settings; });
    return NextResponse.json({ settings });
  } catch (error) { return errorResponse(error); }
}
