import { createHash } from "node:crypto";
import type { SynthesisRequest } from "@/lib/types";
import { compileExpressionScript } from "../lib/expression-script.ts";

const modes = new Set(["tts", "design", "clone", "hifi"]);
const styles = new Set(["natural", "calm", "cheerful", "dramatic"]);

export class InputError extends Error {}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseSynthesisRequest(value: unknown): SynthesisRequest {
  if (!object(value)) throw new InputError("Request body must be an object.");
  const allowed = new Set(["text", "mode", "voiceId", "description", "transcript", "style"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new InputError("Request body contains an unsupported field.");
  const text = typeof value.text === "string" ? value.text : "";
  const mode = typeof value.mode === "string" ? value.mode : "";
  const voiceId = typeof value.voiceId === "string" ? value.voiceId : "";
  const description = typeof value.description === "string" ? value.description : "";
  const transcript = typeof value.transcript === "string" ? value.transcript : "";
  const style = typeof value.style === "string" ? value.style : "";
  if (!text.trim() || text.length > 5000) throw new InputError("text must contain 1–5000 characters.");
  if (!modes.has(mode)) throw new InputError("mode is invalid.");
  if (!styles.has(style)) throw new InputError("style is invalid.");
  const expression = compileExpressionScript(text);
  const expressionError = expression.issues.find((issue) => issue.severity === "error");
  if (expressionError) throw new InputError(expressionError.message);
  if (voiceId.length > 120 || description.length > 1000 || transcript.length > 5000) throw new InputError("One or more request fields exceed their limit.");
  if (mode === "design" && !description.trim()) throw new InputError("Voice Design requires description.");
  if ((mode === "clone" || mode === "hifi") && !voiceId) throw new InputError("Cloning requires voiceId.");
  if (mode === "hifi" && !transcript.trim()) throw new InputError("Hi-Fi requires transcript.");
  if (mode === "hifi" && style !== "natural") throw new InputError("Hi-Fi does not accept a style override.");
  if (mode === "hifi" && expression.hasExpressionTags) throw new InputError("Hi-Fi ignores expression control. Use clone mode for expressive scripts.");
  return { text, mode: mode as SynthesisRequest["mode"], voiceId, description, transcript, style: style as SynthesisRequest["style"] };
}

export function requestHash(request: SynthesisRequest): string {
  return createHash("sha256").update(JSON.stringify(request)).digest("hex");
}

export function validId(value: string): boolean {
  return /^[A-Za-z0-9_-]{8,100}$/.test(value);
}
