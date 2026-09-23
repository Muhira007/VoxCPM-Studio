import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compileExpressionScript,
  EXPRESSION_DEFINITIONS,
} from "../src/lib/expression-script.ts";

test("plain scripts compile to one neutral segment", () => {
  const result = compileExpressionScript("Naskah biasa tanpa ekspresi.");
  assert.equal(result.isValid, true);
  assert.equal(result.hasExpressionTags, false);
  assert.deepEqual(result.segments[0].tags, []);
  assert.equal(result.segments[0].targetText, "Naskah biasa tanpa ekspresi.");
});

test("BEBAS tags compile into VoxCPM control and native tokens", () => {
  const result = compileExpressionScript(
    "Pembuka natural. [excited] Promo ini seru! [laughs] Masa kamu tidak percaya? [sighs] Sayang sekali.",
  );
  assert.equal(result.isValid, true);
  assert.equal(result.tagCount, 3);
  assert.equal(result.segments.length, 4);
  assert.deepEqual(result.segments[1].tags, ["excited"]);
  assert.match(result.segments[1].controlInstruction!, /excited/i);
  assert.equal(result.segments[2].targetText, "[laughing] Masa kamu tidak percaya?");
  assert.equal(result.segments[3].targetText, "[sigh] Sayang sekali.");
  assert.equal(
    result.plainText,
    "Pembuka natural. Promo ini seru! Masa kamu tidak percaya? Sayang sekali.",
  );
});

test("all tags emitted by BEBAS have a compiler definition", () => {
  const tags = EXPRESSION_DEFINITIONS.map((definition) => definition.tag);
  assert.deepEqual(tags, [
    "whispers",
    "laughs",
    "sighs",
    "excited",
    "angry",
    "gasp",
    "shouts",
    "crying",
    "panicked",
    "curious",
    "sarcastic",
    "warm",
    "calm",
    "reassuring",
    "persuasive",
  ]);
  const result = compileExpressionScript(
    tags.map((tag) => `[${tag}] contoh ${tag}.`).join(" "),
  );
  assert.equal(result.isValid, true);
  assert.equal(result.segments.length, tags.length);
});

test("affiliate delivery tags compile into distinct VoxCPM controls", () => {
  const result = compileExpressionScript(
    "[warm] Sapaan ramah. [calm] Penjelasan jelas. [reassuring] Aman digunakan. [persuasive] Cek produknya sekarang.",
  );

  assert.equal(result.dialect, "bebas-v2");
  assert.equal(result.isValid, true);
  assert.match(result.segments[0].controlInstruction!, /warm/i);
  assert.match(result.segments[1].controlInstruction!, /calm/i);
  assert.match(result.segments[2].controlInstruction!, /reassuring/i);
  assert.match(result.segments[3].controlInstruction!, /persuasive/i);
});

test("legacy dialect accepts v1 tags and rejects v2-only tags", () => {
  assert.equal(
    compileExpressionScript("[excited] Promo lama tetap valid.", "bebas-v1").isValid,
    true,
  );
  const unsupported = compileExpressionScript(
    "[persuasive] Tag baru membutuhkan v2.",
    "bebas-v1",
  );
  assert.equal(unsupported.isValid, false);
  assert.equal(unsupported.issues[0].code, "unknown-tag");
});

test("compiler warns when one tag spans too many delivery beats", () => {
  const event = compileExpressionScript(
    "[gasp] Baru tahu? Produk ini lembut. Praktis dibawa ke mana-mana.",
  );
  assert.equal(
    event.issues.some((issue) => issue.code === "long-event-segment"),
    true,
  );

  const delivery = compileExpressionScript(
    "[excited] Manfaat pertama. Manfaat kedua. Manfaat ketiga. Lalu ajakan membeli.",
  );
  assert.equal(
    delivery.issues.some((issue) => issue.code === "long-expression-segment"),
    true,
  );
});

test("consecutive tags combine delivery and event in one segment", () => {
  const result = compileExpressionScript(
    "[excited] [laughs] Ini benar-benar menarik!",
  );
  assert.equal(result.isValid, true);
  assert.deepEqual(result.segments[0].tags, ["excited", "laughs"]);
  assert.match(result.segments[0].controlInstruction!, /energetic/i);
  assert.match(result.segments[0].targetText, /^\[laughing\]/);
});

test("compiler assigns deterministic pauses without trailing silence", () => {
  const result = compileExpressionScript(
    "[shouts] Berhenti! [curious] Kenapa, ya [excited] Karena hemat.",
  );
  assert.deepEqual(
    result.segments.map((segment) => segment.pauseAfterMs),
    [280, 180, 0],
  );
});

test("unknown, malformed, and dangling tags are rejected", () => {
  const unknown = compileExpressionScript("[sad] Jangan sedih.");
  assert.equal(unknown.isValid, false);
  assert.equal(unknown.issues[0].code, "unknown-tag");

  const malformed = compileExpressionScript("[excited Hook besar.");
  assert.equal(malformed.isValid, false);
  assert.equal(malformed.issues[0].code, "malformed-tag");

  const dangling = compileExpressionScript("Naskah selesai. [angry]");
  assert.equal(dangling.isValid, false);
  assert.equal(dangling.issues[0].code, "dangling-tag");
});

test("expressive jobs reject more than fifty segments", () => {
  const result = compileExpressionScript(
    Array.from({ length: 51 }, (_, index) => `[excited] Segmen ${index + 1}.`).join(
      " ",
    ),
  );

  assert.equal(result.segments.length, 51);
  assert.equal(result.isValid, false);
  assert.equal(
    result.issues.some((issue) => issue.code === "too-many-segments"),
    true,
  );
});
