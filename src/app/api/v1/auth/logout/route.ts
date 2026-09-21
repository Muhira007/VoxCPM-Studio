import { NextResponse } from "next/server";
import { ApiError, errorResponse } from "@/server/http";
import {
  requestHasSameOrigin,
  requestIsSecure,
  STUDIO_SESSION_COOKIE,
} from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    if (!requestHasSameOrigin(request))
      throw new ApiError(403, "The request origin is not allowed.");
    const response = NextResponse.json({ authenticated: false });
    response.cookies.set(STUDIO_SESSION_COOKIE, "", {
      httpOnly: true,
      sameSite: "strict",
      secure: requestIsSecure(request),
      path: "/",
      maxAge: 0,
    });
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
