import type {
  RunpodControlState,
  RunpodControlStatus,
} from "../lib/runpod-control-types.ts";
import { runpodController } from "./runpod-controller.ts";

export type RunpodWatchdogAction =
  | "skipped_writes_disabled"
  | "no_action_due"
  | "stop_requested"
  | "stop_verified";

export interface RunpodWatchdogSummary {
  ok: true;
  ranAt: string;
  action: RunpodWatchdogAction;
  phase: RunpodControlState["session"]["phase"];
  podId: string | null;
  hardDeadline: string | null;
  admissionCutoffAt: string | null;
  idleDeadline: string | null;
  runningJobCount: number;
  queuedJobCount: number;
  drainStartedAt: string | null;
  drainCompletedAt: string | null;
  cancelledJobCount: number;
  cancellationFailureCount: number;
  retryCount: number;
  nextRetryAt: string | null;
  stopConfirmedAt: string | null;
  stopReason: RunpodControlState["session"]["stopReason"];
}

interface WatchdogController {
  status(): Promise<RunpodControlStatus>;
  runWatchdog(): Promise<RunpodControlState>;
}

function watchdogAction(
  before: RunpodControlStatus,
  after: RunpodControlState,
): RunpodWatchdogAction {
  if (!before.writeEnabled) return "skipped_writes_disabled";
  if (after.session.phase === "stopped" && before.session.phase !== "stopped")
    return "stop_verified";
  if (
    ["stopping", "error"].includes(after.session.phase) &&
    (after.session.stopRequestedAt !== before.session.stopRequestedAt ||
      after.session.retryCount !== before.session.retryCount)
  )
    return "stop_requested";
  return "no_action_due";
}

export async function runRunpodWatchdogOnce(
  controller: WatchdogController = runpodController,
  now: () => Date = () => new Date(),
): Promise<RunpodWatchdogSummary> {
  const before = await controller.status();
  const after = await controller.runWatchdog();
  return {
    ok: true,
    ranAt: now().toISOString(),
    action: watchdogAction(before, after),
    phase: after.session.phase,
    podId: after.session.podId,
    hardDeadline: after.session.hardDeadline,
    admissionCutoffAt: after.session.admissionCutoffAt,
    idleDeadline: after.session.idleDeadline,
    runningJobCount: after.session.runningJobCount,
    queuedJobCount: after.session.queuedJobCount,
    drainStartedAt: after.session.drainStartedAt,
    drainCompletedAt: after.session.drainCompletedAt,
    cancelledJobCount: after.session.cancelledJobCount,
    cancellationFailureCount: after.session.cancellationFailureCount,
    retryCount: after.session.retryCount,
    nextRetryAt: after.session.nextRetryAt,
    stopConfirmedAt: after.session.stopConfirmedAt,
    stopReason: after.session.stopReason,
  };
}
