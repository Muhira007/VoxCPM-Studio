import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { ServerVoice } from "@/server/contracts";
import { ApiError, errorResponse, requireStudioAccess } from "@/server/http";
import { appStore } from "@/server/store";
import { isAudioQualityReport } from "@/lib/audio-analysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedExtensions = /\.(wav|mp3|flac|m4a|ogg|webm)$/i;
const maximumBytes = 20 * 1024 * 1024;
const contentTypes: Record<string, string> = { wav: "audio/wav", mp3: "audio/mpeg", flac: "audio/flac", m4a: "audio/mp4", ogg: "audio/ogg", webm: "audio/webm" };

async function inspectSignature(file: File): Promise<string | null> {
  const extension = file.name.split(".").at(-1)?.toLowerCase() || "";
  const header = Buffer.from(await file.slice(0, 16).arrayBuffer());
  const ascii = header.toString("ascii");
  const valid = extension === "wav" ? ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WAVE"
    : extension === "flac" ? ascii.startsWith("fLaC")
    : extension === "ogg" ? ascii.startsWith("OggS")
    : extension === "webm" ? header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
    : extension === "m4a" ? ascii.slice(4, 8) === "ftyp"
    : extension === "mp3" ? ascii.startsWith("ID3") || (header[0] === 0xff && (header[1] & 0xe0) === 0xe0)
    : false;
  return valid ? contentTypes[extension] : null;
}

function publicVoice(voice: ServerVoice) {
  return { id: voice.id, name: voice.name, description: voice.description, fileName: voice.fileName, contentType: voice.contentType, size: voice.size, analysis: voice.analysis, createdAt: voice.createdAt };
}

export async function GET(request: Request) {
  const unauthorized = requireStudioAccess(request);
  if (unauthorized) return unauthorized;
  try {
    const state = await appStore.read();
    return NextResponse.json({ voices: state.voices.map(publicVoice) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  const unauthorized = requireStudioAccess(request);
  if (unauthorized) return unauthorized;
  try {
    const declared = Number(request.headers.get("content-length") || 0);
    if (declared > maximumBytes + 64 * 1024) throw new ApiError(413, "Audio upload exceeds 20 MB.");
    const form = await request.formData();
    const file = form.get("file");
    const name = String(form.get("name") || "").trim();
    const description = String(form.get("description") || "").trim();
    const analysisText = String(form.get("analysis") || "");
    if (!(file instanceof File)) throw new ApiError(422, "file is required.");
    if (!name || name.length > 60) throw new ApiError(422, "name must contain 1–60 characters.");
    if (description.length > 300) throw new ApiError(422, "description cannot exceed 300 characters.");
    if (!analysisText || analysisText.length > 16_384)
      throw new ApiError(422, "A bounded audio quality report is required.");
    let analysis: unknown;
    try {
      analysis = JSON.parse(analysisText);
    } catch {
      throw new ApiError(422, "The audio quality report is not valid JSON.");
    }
    if (!isAudioQualityReport(analysis) || analysis.status === "fail")
      throw new ApiError(422, "The audio quality report is invalid or failed.");
    if (!allowedExtensions.test(file.name)) throw new ApiError(422, "Use WAV, MP3, FLAC, M4A, OGG, or WebM.");
    if (!file.size || file.size > maximumBytes) throw new ApiError(422, "Audio must be larger than 0 and no more than 20 MB.");
    const contentType = await inspectSignature(file);
    if (!contentType) throw new ApiError(422, "The file signature does not match a supported audio format.");
    const extension = file.name.split(".").at(-1)?.toUpperCase();
    if (analysis.format !== extension || analysis.durationSeconds > 300)
      throw new ApiError(422, "The audio quality report does not match the uploaded file.");
    const storageName = await appStore.saveReference(file);
    const voice: ServerVoice = { id: `voice_${randomUUID().replaceAll("-", "")}`, name, description, fileName: file.name.slice(0, 255), storageName, contentType, size: file.size, analysis, createdAt: new Date().toISOString() };
    try {
      await appStore.addVoice(voice);
    } catch (error) {
      await appStore.removeReference(voice).catch(() => undefined);
      throw error;
    }
    return NextResponse.json({ voice: publicVoice(voice) }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
