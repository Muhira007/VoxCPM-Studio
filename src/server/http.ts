import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server.js";
import {
  serverConfig,
  validateServerConfiguration,
  validateWebAuthConfiguration,
} from "./config.ts";
import {
  cookieValue,
  requestHasSameOrigin,
  STUDIO_SESSION_COOKIE,
  verifySessionToken,
} from "./session.ts";
import { InputError } from "./validation.ts";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function suppliedKeyIsValid(request: Request): boolean {
  const supplied = request.headers.get("x-studio-key") || "";
  const expected = serverConfig.studioApiKey;
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  return (
    suppliedBytes.length === expectedBytes.length &&
    timingSafeEqual(suppliedBytes, expectedBytes)
  );
}

export function requireStudioAccess(request: Request): NextResponse | null {
  const configurationErrors = validateServerConfiguration();
  if (configurationErrors.length) return NextResponse.json({ error: "server_not_configured", message: configurationErrors[0] }, { status: 503 });
  if (suppliedKeyIsValid(request)) return null;

  const webAuthErrors = validateWebAuthConfiguration();
  if (webAuthErrors.length)
    return NextResponse.json(
      { error: "web_auth_not_configured", message: webAuthErrors[0] },
      { status: 503 },
    );
  const token = cookieValue(request, STUDIO_SESSION_COOKIE);
  const session = verifySessionToken(token, serverConfig.studioSessionSecret);
  if (!session.authenticated)
    return NextResponse.json(
      { error: "unauthorized", message: "Studio session is missing or expired." },
      { status: 401 },
    );
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && !requestHasSameOrigin(request))
    return NextResponse.json(
      { error: "invalid_origin", message: "The request origin is not allowed." },
      { status: 403 },
    );
  return null;
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
