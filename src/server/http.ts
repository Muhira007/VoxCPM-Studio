import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { serverConfig, validateServerConfiguration } from "./config";
import { InputError } from "./validation";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function requireStudioKey(request: Request): NextResponse | null {
  const configurationErrors = validateServerConfiguration();
  if (configurationErrors.length) return NextResponse.json({ error: "server_not_configured", message: configurationErrors[0] }, { status: 503 });
  const supplied = request.headers.get("x-studio-key") || "";
  const expected = serverConfig.studioApiKey;
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  const valid = suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes);
  return valid ? null : NextResponse.json({ error: "unauthorized", message: "Invalid studio credential." }, { status: 401 });
}

export async function readJson(request: Request, limit = 64 * 1024): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > limit) throw new ApiError(413, "Request body is too large.");
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > limit) throw new ApiError(413, "Request body is too large.");
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "Request body must contain valid JSON.");
  }
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof ApiError) return NextResponse.json({ error: "request_failed", message: error.message }, { status: error.status });
  if (error instanceof InputError) return NextResponse.json({ error: "validation_failed", message: error.message }, { status: 422 });
  return NextResponse.json({ error: "internal_error", message: "Unexpected server error." }, { status: 500 });
}
