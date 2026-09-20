import { NextResponse } from "next/server";
import { ApiError, errorResponse, requireStudioKey } from "@/server/http";
import { appStore } from "@/server/store";
import { validId } from "@/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = requireStudioKey(request);
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    if (!validId(id)) throw new ApiError(400, "Invalid voice ID.");
    const voice = await appStore.removeVoice(id);
    if (!voice) throw new ApiError(404, "Voice not found.");
    await appStore.removeReference(voice);
    return new NextResponse(null, { status: 204 });
  } catch (error) { return errorResponse(error); }
}
