import { NextResponse } from "next/server";
import {
  serverConfig,
  validateServerConfiguration,
  validateWebAuthConfiguration,
} from "@/server/config";
import {
  cookieValue,
  STUDIO_SESSION_COOKIE,
  verifySessionToken,
} from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const configured = [
    ...validateServerConfiguration(),
    ...validateWebAuthConfiguration(),
  ].length === 0;
  if (!configured)
    return NextResponse.json(
      {
        configured: false,
        authenticated: false,
        expiresAt: null,
        message: "Web UI API belum dikonfigurasi lengkap pada server.",
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  const session = verifySessionToken(
    cookieValue(request, STUDIO_SESSION_COOKIE),
    serverConfig.studioSessionSecret,
  );
  return NextResponse.json(
    {
      configured: true,
      authenticated: session.authenticated,
      expiresAt: session.expiresAt
        ? new Date(session.expiresAt).toISOString()
        : null,
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}
