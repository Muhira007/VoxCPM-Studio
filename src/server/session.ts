import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const STUDIO_SESSION_COOKIE = "voxcpm_studio_session";
export const STUDIO_SESSION_TTL_SECONDS = 12 * 60 * 60;

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function passwordMatches(supplied: string, expected: string): boolean {
  return safeEqual(supplied, expected);
}

export function createSessionToken(
  secret: string,
  now = Date.now(),
): { token: string; expiresAt: number } {
  const expiresAt = now + STUDIO_SESSION_TTL_SECONDS * 1000;
  const payload = `v1.${expiresAt}.${randomBytes(18).toString("base64url")}`;
  return { token: `${payload}.${signature(payload, secret)}`, expiresAt };
}

export function verifySessionToken(
  token: string,
  secret: string,
  now = Date.now(),
): { authenticated: boolean; expiresAt: number | null } {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v1")
    return { authenticated: false, expiresAt: null };
  const expiresAt = Number(parts[1]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now)
    return { authenticated: false, expiresAt: null };
  const payload = parts.slice(0, 3).join(".");
  const valid = safeEqual(parts[3], signature(payload, secret));
  return {
    authenticated: valid,
    expiresAt: valid ? expiresAt : null,
  };
}

export function cookieValue(request: Request, name: string): string {
  const cookies = request.headers.get("cookie") || "";
  for (const entry of cookies.split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 0) continue;
    if (entry.slice(0, separator).trim() === name) {
      try {
        return decodeURIComponent(entry.slice(separator + 1).trim());
      } catch {
        return "";
      }
    }
  }
  return "";
}

export function requestHasSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const supplied = new URL(origin);
    const requestUrl = new URL(request.url);
    if (supplied.origin === requestUrl.origin) return true;
    const forwardedHost = request.headers.get("x-forwarded-host");
    const host = forwardedHost || request.headers.get("host");
    const forwardedProtocol = request.headers.get("x-forwarded-proto");
    const protocol = forwardedProtocol
      ? `${forwardedProtocol.replace(/:$/, "")}:`
      : requestUrl.protocol;
    return Boolean(host && supplied.host === host && supplied.protocol === protocol);
  } catch {
    return false;
  }
}

export function requestIsSecure(request: Request): boolean {
  const forwarded = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    .trim()
    .toLowerCase();
  if (forwarded) return forwarded === "https";
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}
