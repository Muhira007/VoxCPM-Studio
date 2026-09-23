import { runRunpodPreflight } from "../src/server/runpod-preflight.ts";

try {
  const report = await runRunpodPreflight();
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (process.argv.includes("--require-ready") && !report.readyForPaidCycle)
    process.exitCode = 2;
} catch {
  process.stderr.write(
    `${JSON.stringify({ ok: false, error: "preflight_failed", message: "RunPod preflight failed unexpectedly." })}\n`,
  );
  process.exitCode = 1;
}
