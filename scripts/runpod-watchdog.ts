import { runRunpodWatchdogOnce } from "../src/server/runpod-watchdog-runner.ts";

try {
  const summary = await runRunpodWatchdogOnce();
  process.stdout.write(`${JSON.stringify(summary)}\n`);
} catch (error) {
  const message =
    error instanceof Error
      ? error.message
      : "Unexpected RunPod watchdog failure.";
  process.stderr.write(
    `${JSON.stringify({ ok: false, error: "watchdog_failed", message })}\n`,
  );
  process.exitCode = 1;
}
