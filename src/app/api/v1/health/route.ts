import { NextResponse } from "next/server";
import { validateServerConfiguration } from "@/server/config";
import { appStore } from "@/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const configuration = validateServerConfiguration();
  try {
    await appStore.probe();
    return NextResponse.json({ status: configuration.length ? "degraded" : "ok", service: "voxcpm-studio-api", mode: "local-worker-simulation", storage: "writable", configured: configuration.length === 0 });
  } catch {
    return NextResponse.json({ status: "error", service: "voxcpm-studio-api", mode: "local-worker-simulation", storage: "unavailable", configured: configuration.length === 0 }, { status: 503 });
  }
}
