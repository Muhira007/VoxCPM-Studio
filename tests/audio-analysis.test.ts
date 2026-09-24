import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  analyzePcmAudio,
  isAudioQualityReport,
} from "../src/lib/audio-analysis.ts";
import { compileExpressionScript } from "../src/lib/expression-script.ts";

function tone(seconds: number, sampleRate: number, amplitude: number) {
  const data = new Float32Array(seconds * sampleRate);
  for (let index = 0; index < data.length; index += 1)
    data[index] = Math.sin((2 * Math.PI * 220 * index) / sampleRate) * amplitude;
  return data;
}

test("clean mono WAV passes all local reference checks", () => {
  const report = analyzePcmAudio({
    channelData: [tone(20, 24_000, 0.3)],
    sampleRate: 24_000,
    format: "wav",
    bitDepth: 16,
    analyzedAt: 1,
  });

  assert.equal(report.status, "pass");
  assert.equal(report.format, "WAV");
  assert.equal(report.durationSeconds, 20);
  assert.equal(report.channels, 1);
  assert.equal(report.bitDepth, 16);
  assert.equal(report.findings.length, 7);
  assert.equal(isAudioQualityReport(report), true);
});

test("compressed stereo and hot peaks produce actionable warnings", () => {
  const left = tone(20, 24_000, 0.2);
  const right = tone(20, 24_000, 0.2);
  left[500] = 0.95;
  const report = analyzePcmAudio({
    channelData: [left, right],
    sampleRate: 24_000,
    format: "mp3",
  });

  assert.equal(report.status, "warning");
  assert.equal(
    report.findings.find((item) => item.code === "format")?.status,
    "warning",
  );
  assert.equal(
    report.findings.find((item) => item.code === "channels")?.status,
    "warning",
  );
  assert.equal(
    report.findings.find((item) => item.code === "clipping")?.status,
    "warning",
  );
});

test("short low-rate clipped audio fails readiness", () => {
  const samples = new Float32Array(4 * 8_000).fill(1);
  const report = analyzePcmAudio({
    channelData: [samples],
    sampleRate: 8_000,
    format: "wav",
    bitDepth: 8,
  });

  assert.equal(report.status, "fail");
  assert.ok(report.clippingPercent > 99);
  assert.equal(
    report.findings.find((item) => item.code === "duration")?.status,
    "fail",
  );
  assert.equal(
    report.findings.find((item) => item.code === "sample-rate")?.status,
    "fail",
  );
  assert.equal(isAudioQualityReport({ ...report, status: "pass" }), false);
});

test("edge silence is measured per frame across channels", () => {
  const sampleRate = 24_000;
  const samples = new Float32Array(20 * sampleRate);
  samples.set(tone(13, sampleRate, 0.2), 3 * sampleRate);
  const report = analyzePcmAudio({
    channelData: [samples],
    sampleRate,
    format: "wav",
  });

  assert.equal(report.status, "warning");
  assert.ok(Math.abs(report.leadingSilenceSeconds - 3) < 0.001);
  assert.ok(Math.abs(report.trailingSilenceSeconds - 4) < 0.001);
});

test("quality corpus contains 24 valid and versioned Indonesian cases", async () => {
  const corpus = JSON.parse(
    await readFile("public/quality/voice-quality-test-corpus.json", "utf8"),
  ) as {
    schema: string;
    version: number;
    language: string;
    expressionDialect: "bebas-v2";
    cases: Array<{
      id: string;
      mode: string;
      script: string;
      expectedTags: string[];
    }>;
  };

  assert.equal(corpus.schema, "voxcpm-studio-quality-corpus");
  assert.equal(corpus.version, 1);
  assert.equal(corpus.language, "id-ID");
  assert.equal(corpus.expressionDialect, "bebas-v2");
  assert.equal(corpus.cases.length, 24);
  assert.equal(new Set(corpus.cases.map((item) => item.id)).size, 24);
  assert.ok(corpus.cases.some((item) => item.mode === "hifi"));

  for (const item of corpus.cases) {
    const compiled = compileExpressionScript(item.script, corpus.expressionDialect);
    assert.equal(compiled.isValid, true, item.id);
    assert.deepEqual(compiled.issues, [], item.id);
    assert.deepEqual(
      compiled.segments.flatMap((segment) => segment.tags),
      item.expectedTags,
      item.id,
    );
    if (item.mode === "hifi") assert.equal(compiled.hasExpressionTags, false, item.id);
  }
});
