import { NextResponse } from "next/server";
import {
  serverConfig,
  validateServerConfiguration,
  validateWebAuthConfiguration,
} from "@/server/config";
import { ApiError, errorResponse, readJson } from "@/server/http";
import {
  createSessionToken,
  passwordMatches,
  requestHasSameOrigin,
  requestIsSecure,
  STUDIO_SESSION_COOKIE,
  STUDIO_SESSION_TTL_SECONDS,
} from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const failures = new Map<string, { count: number; resetAt: number }>();

function pruneFailures(now: number) {
  for (const [key, value] of failures)
    if (value.resetAt <= now) failures.delete(key);
  if (failures.size >= 1000) failures.delete(failures.keys().next().value || "");
}

function clientKey(request: Request): string {
  return (request.headers.get("x-forwarded-for") || "local")
    .split(",")[0]
    .trim();
}

export async function POST(request: Request) {
  try {
    const configurationErrors = [
      ...validateServerConfiguration(),
      ...validateWebAuthConfiguration(),
    ];
    if (configurationErrors.length)
      throw new ApiError(503, configurationErrors[0]);
    if (!requestHasSameOrigin(request))
      throw new ApiError(403, "The request origin is not allowed.");

    const key = clientKey(request);
    pruneFailures(Date.now());
    const previous = failures.get(key);
    if (previous && previous.resetAt > Date.now() && previous.count >= 5)
      throw new ApiError(429, "Terlalu banyak percobaan. Tunggu lima menit lalu coba lagi.");
    if (previous && previous.resetAt <= Date.now()) failures.delete(key);

    const body = await readJson(request, 4096);
    const password =
      body && typeof body === "object" && "password" in body
        ? String(body.password)
        : "";
    if (!passwordMatches(password, serverConfig.studioAccessPassword)) {
      const current = failures.get(key);
      failures.set(key, {
        count: (current?.count || 0) + 1,
        resetAt: current?.resetAt || Date.now() + 5 * 60_000,
      });
      throw new ApiError(401, "Kata sandi studio tidak cocok.");
    }

    failures.delete(key);
    const session = createSessionToken(serverConfig.studioSessionSecret);
    const response = NextResponse.json({
      authenticated: true,
      expiresAt: new Date(session.expiresAt).toISOString(),
    });
    response.cookies.set(STUDIO_SESSION_COOKIE, session.token, {
      httpOnly: true,
      sameSite: "strict",
      secure: requestIsSecure(request),
      path: "/",
      maxAge: STUDIO_SESSION_TTL_SECONDS,
    });
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
