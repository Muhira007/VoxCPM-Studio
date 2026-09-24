import { NextResponse } from "next/server";
import { ApiError, errorResponse, readJson, requireStudioAccess } from "@/server/http";
import { appStore } from "@/server/store";
import { validId } from "@/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = requireStudioAccess(request);
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    if (!validId(id)) throw new ApiError(400, "Invalid voice ID.");
    const body = await readJson(request, 4096);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new ApiError(422, "Voice details must be an object.");
    const value = body as Record<string, unknown>;
    if (Object.keys(value).some((key) => !["name", "description"].includes(key)))
      throw new ApiError(422, "Voice details contain an unsupported field.");
    const name = String(value.name || "").trim();
    const description = String(value.description || "").trim();
    if (!name || name.length > 60)
      throw new ApiError(422, "name must contain 1–60 characters.");
    if (description.length > 300)
      throw new ApiError(422, "description cannot exceed 300 characters.");
    const voice = await appStore.mutate((state) => {
      const index = state.voices.findIndex((item) => item.id === id);
      if (index < 0) return null;
      state.voices[index] = { ...state.voices[index], name, description };
      return structuredClone(state.voices[index]);
    });
    if (!voice) throw new ApiError(404, "Voice not found.");
    return NextResponse.json({
      voice: {
        id: voice.id,
        name: voice.name,
        description: voice.description,
        fileName: voice.fileName,
        contentType: voice.contentType,
        size: voice.size,
        analysis: voice.analysis,
        createdAt: voice.createdAt,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const unauthorized = requireStudioAccess(request);
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
