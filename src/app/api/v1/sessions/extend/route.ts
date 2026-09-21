import { NextResponse } from "next/server";
import { ApiError, errorResponse, readJson, requireStudioAccess } from "@/server/http";
import { enforceSessionDeadline } from "@/server/services";
import { appStore } from "@/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const unauthorized = requireStudioAccess(request);
  if (unauthorized) return unauthorized;
  try {
    const body = await readJson(request);
    const minutes = body && typeof body === "object" && "minutes" in body ? Number(body.minutes) : 30;
    if (minutes !== 30) throw new ApiError(422, "A local session can only be extended by 30 minutes at a time.");
    const session = await enforceSessionDeadline();
    if (session.status !== "ready" || !session.startedAt || !session.expiresAt) throw new ApiError(409, "No ready session can be extended.");
    const maximum = Date.parse(session.startedAt) + 4 * 60 * 60_000;
    const next = Math.min(Date.parse(session.expiresAt) + minutes * 60_000, maximum);
    if (next <= Date.parse(session.expiresAt)) throw new ApiError(409, "The session already reached its four-hour maximum.");
    const updated = await appStore.replaceSession({ ...session, expiresAt: new Date(next).toISOString(), message: "Local worker simulation session extended." });
    return NextResponse.json({ session: updated });
  } catch (error) { return errorResponse(error); }
}
