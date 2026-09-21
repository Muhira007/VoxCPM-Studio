import { NextResponse } from "next/server";
import { validateRunpodReadConfiguration } from "@/server/config";
import { ApiError, errorResponse, requireStudioAccess } from "@/server/http";
import { runpodClient } from "@/server/runpod-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = requireStudioAccess(request);
  if (unauthorized) return unauthorized;
  try {
    const errors = validateRunpodReadConfiguration();
    if (errors.length) throw new ApiError(503, errors[0]);
    const fresh = new URL(request.url).searchParams.get("fresh") === "1";
    return NextResponse.json({
      overview: await runpodClient.overview({ fresh }),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
