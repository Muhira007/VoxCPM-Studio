import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_BEBAS_PACKAGE_BYTES,
  parseBebasScriptPackage,
} from "../src/lib/bebas-script-package.ts";

const validPackage = {
  schema: "voxcpm-studio-script",
  version: 1,
  expressionDialect: "bebas-v2",
  script: "[excited] Jangan checkout dulu! [curious] Sudah cek detailnya?",
  caption: "Produk menarik untuk konten affiliate. #rekomendasi",
};

test("BEBAS v2 packages import script and keep caption as metadata", () => {
  const parsed = parseBebasScriptPackage(JSON.stringify(validPackage));

  assert.deepEqual(parsed, validPackage);
});

test("BEBAS importer keeps legacy v1 packages compatible", () => {
  const legacyPackage = {
    ...validPackage,
    expressionDialect: "bebas-v1",
  };

  assert.deepEqual(
    parseBebasScriptPackage(JSON.stringify(legacyPackage)),
    legacyPackage,
  );
  assert.throws(() =>
    parseBebasScriptPackage(
      JSON.stringify({
        ...legacyPackage,
        script: "[persuasive] Tag ini hanya tersedia di bebas-v2.",
      }),
    ),
  );
});

test("BEBAS import rejects unsupported schema, version, and dialect", () => {
  for (const invalid of [
    { ...validPackage, schema: "unknown" },
    { ...validPackage, version: 2 },
    { ...validPackage, expressionDialect: "elevenlabs-v3" },
  ]) {
    assert.throws(() => parseBebasScriptPackage(JSON.stringify(invalid)));
  }
});

test("BEBAS import rejects invalid expression scripts and malformed JSON", () => {
  assert.throws(() =>
    parseBebasScriptPackage(
      JSON.stringify({ ...validPackage, script: "[sad] Jangan sedih." }),
    ),
  );
  assert.throws(() => parseBebasScriptPackage("{not-json}"));
});

test("BEBAS import enforces bounded files and required caption text", () => {
  assert.throws(() =>
    parseBebasScriptPackage(" ".repeat(MAX_BEBAS_PACKAGE_BYTES + 1)),
  );
  assert.throws(() =>
    parseBebasScriptPackage(
      JSON.stringify({ ...validPackage, caption: null }),
    ),
  );
});
