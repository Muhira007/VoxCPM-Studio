import { NextResponse } from "next/server";
import { errorResponse, requireStudioAccess } from "@/server/http";
import { stopSession } from "@/server/services";
import { appStore } from "@/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request) {
  const unauthorized = requireStudioAccess(request);
  if (unauthorized) return unauthorized;
  try {
    await stopSession("Local worker session stopped during data reset.");
    const voices = (await appStore.read()).voices;
    await Promise.all(voices.map((voice) => appStore.removeReference(voice)));
    await appStore.mutate((state) => {
      state.jobs = [];
      state.voices = [];
      state.settings = {
        sessionMinutes: 60,
        idleMinutes: 10,
        maximumHourlyRate: 0.8,
        gpuProfile: "a5000",
      };
      state.session = {
        status: "off",
        startedAt: null,
        expiresAt: null,
        endedAt: new Date().toISOString(),
        message: "Local application data was reset.",
        mode: "worker-simulation",
      };
    });
    return NextResponse.json({ reset: true });
  } catch (error) {
    return errorResponse(error);
  }
}
