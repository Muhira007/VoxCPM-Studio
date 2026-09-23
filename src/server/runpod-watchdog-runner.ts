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
  costEstimate: RunpodControlStatus["costEstimate"];
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
  const current = await controller.status();
  return {
    ok: true,
    ranAt: now().toISOString(),
    action: watchdogAction(before, after),
    phase: current.session.phase,
    podId: current.session.podId,
    hardDeadline: current.session.hardDeadline,
    admissionCutoffAt: current.session.admissionCutoffAt,
    idleDeadline: current.session.idleDeadline,
    runningJobCount: current.session.runningJobCount,
    queuedJobCount: current.session.queuedJobCount,
    drainStartedAt: current.session.drainStartedAt,
    drainCompletedAt: current.session.drainCompletedAt,
    cancelledJobCount: current.session.cancelledJobCount,
    cancellationFailureCount: current.session.cancellationFailureCount,
    retryCount: current.session.retryCount,
    nextRetryAt: current.session.nextRetryAt,
    stopConfirmedAt: current.session.stopConfirmedAt,
    stopReason: current.session.stopReason,
    costEstimate: current.costEstimate,
  };
}
