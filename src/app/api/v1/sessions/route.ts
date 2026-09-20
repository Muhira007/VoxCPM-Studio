import { NextResponse } from "next/server";
import { ApiError, errorResponse, readJson, requireStudioKey } from "@/server/http";
import { enforceSessionDeadline, stopSession } from "@/server/services";
import { appStore } from "@/server/store";
import { workerReady } from "@/server/worker-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = requireStudioKey(request);
  if (unauthorized) return unauthorized;
  try { return NextResponse.json({ session: await enforceSessionDeadline() }); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  const unauthorized = requireStudioKey(request);
  if (unauthorized) return unauthorized;
  try {
    const body = await readJson(request);
    const durationMinutes = body && typeof body === "object" && "durationMinutes" in body ? Number(body.durationMinutes) : 60;
    if (![30, 60, 120, 240].includes(durationMinutes)) throw new ApiError(422, "durationMinutes must be 30, 60, 120, or 240.");
    const current = await enforceSessionDeadline();
    if (["loading", "ready"].includes(current.status)) return NextResponse.json({ session: current, created: false });
    await appStore.replaceSession({ status: "loading", startedAt: new Date().toISOString(), expiresAt: null, endedAt: null, message: "Checking local worker readiness.", mode: "worker-simulation" });
    if (!await workerReady()) throw new ApiError(503, "Worker is reachable but its model contract is not ready.");
    const startedAt = new Date();
    const session = await appStore.replaceSession({ status: "ready", startedAt: startedAt.toISOString(), expiresAt: new Date(startedAt.getTime() + durationMinutes * 60_000).toISOString(), endedAt: null, message: "Local worker simulation is ready. VoxCPM2 is not loaded.", mode: "worker-simulation" });
    return NextResponse.json({ session, created: true }, { status: 201 });
  } catch (error) {
    const state = await appStore.read().catch(() => null);
    if (state?.session.status === "loading") await appStore.replaceSession({ ...state.session, status: "error", endedAt: new Date().toISOString(), message: error instanceof Error ? error.message : "Session failed." }).catch(() => undefined);
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  const unauthorized = requireStudioKey(request);
  if (unauthorized) return unauthorized;
  try { return NextResponse.json({ session: await stopSession() }); }
  catch (error) { return errorResponse(error); }
}
