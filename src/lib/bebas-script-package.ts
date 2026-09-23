import {
  compileExpressionScript,
  EXPRESSION_DIALECT,
} from "./expression-script.ts";

export const BEBAS_PACKAGE_SCHEMA = "voxcpm-studio-script" as const;
export const BEBAS_PACKAGE_VERSION = 1 as const;
export const MAX_BEBAS_PACKAGE_BYTES = 64 * 1024;
export const MAX_BEBAS_CAPTION_LENGTH = 20_000;

export interface BebasScriptPackage {
  schema: typeof BEBAS_PACKAGE_SCHEMA;
  version: typeof BEBAS_PACKAGE_VERSION;
  expressionDialect: typeof EXPRESSION_DIALECT;
  script: string;
  caption: string;
}

function packageError(message: string): never {
  throw new Error(`Paket BEBAS tidak valid: ${message}`);
}

export function parseBebasScriptPackage(
  serialized: string,
): BebasScriptPackage {
  if (new TextEncoder().encode(serialized).byteLength > MAX_BEBAS_PACKAGE_BYTES)
    packageError("ukuran JSON melebihi 64 KB.");

  let value: unknown;
  try {
    value = JSON.parse(serialized.replace(/^\uFEFF/, ""));
  } catch {
    packageError("isi berkas bukan JSON yang benar.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    packageError("akar JSON harus berupa objek.");

  const data = value as Record<string, unknown>;
  if (data.schema !== BEBAS_PACKAGE_SCHEMA)
    packageError(`schema harus \"${BEBAS_PACKAGE_SCHEMA}\".`);
  if (data.version !== BEBAS_PACKAGE_VERSION)
    packageError(`version yang didukung hanya ${BEBAS_PACKAGE_VERSION}.`);
  if (data.expressionDialect !== EXPRESSION_DIALECT)
    packageError(`expressionDialect harus \"${EXPRESSION_DIALECT}\".`);
  if (typeof data.script !== "string")
    packageError("script harus berupa teks.");
  if (typeof data.caption !== "string")
    packageError("caption harus berupa teks.");

  const script = data.script.trim();
  const caption = data.caption.trim();
  if (!script || script.length > 5000)
    packageError("script harus berisi 1–5.000 karakter.");
  if (caption.length > MAX_BEBAS_CAPTION_LENGTH)
    packageError("caption tidak boleh melebihi 20.000 karakter.");

  const compiled = compileExpressionScript(script);
  const expressionError = compiled.issues.find(
    (issue) => issue.severity === "error",
  );
  if (expressionError) packageError(expressionError.message);

  return {
    schema: BEBAS_PACKAGE_SCHEMA,
    version: BEBAS_PACKAGE_VERSION,
    expressionDialect: EXPRESSION_DIALECT,
    script,
    caption,
  };
}
