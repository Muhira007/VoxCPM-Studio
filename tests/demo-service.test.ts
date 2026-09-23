import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DemoStudioService,
  validateRequest,
  type Runtime,
} from "../src/lib/demo-service.ts";
import { DEFAULT_DRAFT } from "../src/lib/fixtures.ts";
import type { Voice } from "../src/lib/types.ts";

// A controlled clock exercises cancellation and session deadlines without real waits.
class TestClock implements Runtime {
  private time = 100000;
  private nextId = 0;
  private timers = new Map<number, { at: number; callback: () => void }>();
  now = () => this.time;
  schedule = (callback: () => void, delay: number) => {
    const id = ++this.nextId;
    this.timers.set(id, { at: this.time + delay, callback });
    return id as unknown as ReturnType<typeof setTimeout>;
  };
  clear = (id: ReturnType<typeof setTimeout>) => {
    this.timers.delete(id as unknown as number);
  };
  advance(ms: number) {
    const target = this.time + ms;
    while (true) {
      const due = [...this.timers.entries()]
        .filter(([, task]) => task.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.time = due[1].at;
      this.timers.delete(due[0]);
      due[1].callback();
    }
    this.time = target;
  }
  jump(ms: number) {
    this.time += ms;
  }
}
function setup(ready = true) {
  const clock = new TestClock();
  const service = new DemoStudioService(clock);
  service.hydrate(null);
  if (ready) {
    service.startSession();
    clock.advance(2600);
  }
  return { clock, service, snapshot: service.getSnapshot };
}
const reference: Voice = {
  id: "local-reference",
  name: "Rekaman uji",
  description: "",
  source: "upload",
  color: "green",
  duration: 8,
  fileName: "reference.wav",
  createdAt: 100000,
};

test("repeated starts and generate clicks create one session and one active job", () => {
  const { clock, service, snapshot } = setup(false);
  service.startSession();
  const deadline = snapshot().session.expiresAt;
  clock.advance(300);
  service.startSession();
  assert.equal(snapshot().session.expiresAt, deadline);
  clock.advance(2300);
  assert.equal(snapshot().session.status, "ready");
  service.generate();
  service.generate();
  assert.equal(snapshot().jobs.length, 1);
  clock.advance(600);
  service.generate();
  assert.equal(snapshot().jobs.length, 1);
  clock.advance(2400);
  assert.equal(snapshot().jobs[0].status, "succeeded");
  assert.equal(snapshot().jobs[0].audioUrl, null);
  assert.equal(snapshot().jobs[0].audioDuration, null);
});

test("stopping during loading cancels old timers and permits a clean restart", () => {
  const { clock, service, snapshot } = setup(false);
  service.updateSettings({ scenario: "slow" });
  service.startSession();
  clock.advance(1100);
  assert.equal(snapshot().session.status, "loading");
  service.stopSession();
  clock.advance(10000);
  assert.equal(snapshot().session.status, "off");
  service.updateSettings({ scenario: "normal" });
  service.startSession();
  clock.advance(2600);
  assert.equal(snapshot().session.status, "ready");
});

test("cancelled running job cannot later succeed; retry retains an independent snapshot", () => {
  const { clock, service, snapshot } = setup();
  service.generate();
  clock.advance(600);
  const id = snapshot().jobs[0].id;
  service.cancelJob(id);
  service.updateDraft({ text: "Naskah percobaan ulang." });
  service.generate();
  clock.advance(4000);
  assert.equal(snapshot().jobs.length, 2);
  assert.equal(snapshot().jobs[0].status, "succeeded");
  assert.equal(snapshot().jobs[0].request.text, "Naskah percobaan ulang.");
  assert.equal(
    snapshot().jobs.find((job) => job.id === id)?.status,
    "cancelled",
  );
});

test("refresh restores draft and preferences but cancels unfinished simulation", () => {
  const { clock, service } = setup();
  service.addVoice(reference);
  service.updateDraft({
    text: "Draft tersimpan.",
    mode: "clone",
    voiceId: reference.id,
  });
  service.updateSettings({ idleMinutes: 15 });
  service.generate();
  clock.advance(600);
  const restored = new DemoStudioService(clock);
  restored.hydrate(service.serialize());
  assert.equal(restored.getSnapshot().draft.text, "Draft tersimpan.");
  assert.equal(restored.getSnapshot().voices.at(-1)?.fileName, "reference.wav");
  assert.equal(restored.getSnapshot().settings.idleMinutes, 15);
  assert.equal(restored.getSnapshot().session.status, "off");
  assert.equal(restored.getSnapshot().jobs[0].status, "cancelled");
  assert.equal(restored.getSnapshot().jobs[0].audioUrl, null);
});

test("corrupt local data falls back safely", () => {
  for (const value of [
    "{broken",
    '{"version":999}',
    '{"version":1,"draft":null}',
  ]) {
    const service = new DemoStudioService(new TestClock());
    service.hydrate(value);
    assert.equal(service.getSnapshot().hydrated, true);
    assert.equal(service.getSnapshot().draft.text, DEFAULT_DRAFT.text);
    assert.ok(service.getSnapshot().storageWarning);
  }
});

test("hard deadline stops a busy job even when browser timer callbacks are delayed", () => {
  const { clock, service, snapshot } = setup();
  service.generate();
  clock.jump(60 * 60000);
  service.tick();
  assert.equal(snapshot().session.status, "stopping");
  assert.equal(snapshot().jobs[0].status, "cancelled");
  clock.advance(650);
  assert.equal(snapshot().session.status, "off");
});

test("idle timeout leaves active jobs running and stops an idle session", () => {
  const active = setup();
  active.service.generate();
  active.clock.jump(11 * 60000);
  active.service.tick();
  assert.equal(active.snapshot().session.status, "ready");
  assert.equal(active.snapshot().jobs[0].status, "queued");
  const idle = setup();
  idle.clock.advance(10 * 60000);
  idle.service.tick();
  assert.equal(idle.snapshot().session.status, "stopping");
});

test("session extension never exceeds four hours", () => {
  const { service, snapshot } = setup();
  for (let count = 0; count < 6; count++) service.extendSession();
  assert.equal(
    snapshot().session.expiresAt! - snapshot().session.startedAt!,
    4 * 60 * 60000,
  );
  assert.throws(() => service.extendSession(), /maksimum/);
});

test("price ceiling and invalid inputs prevent starting work", () => {
  const { service, snapshot } = setup(false);
  service.updateSettings({ maxHourlyRate: 0.1 });
  assert.throws(() => service.startSession(), /batas harga/);
  assert.equal(snapshot().session.status, "off");
  assert.throws(() => service.generate(), /tunggu/);
  assert.match(validateRequest({ ...DEFAULT_DRAFT, text: " " }, [])!, /naskah/);
  assert.match(
    validateRequest({ ...DEFAULT_DRAFT, mode: "design", description: "" }, [])!,
    /deskripsi/,
  );
  assert.match(
    validateRequest({ ...DEFAULT_DRAFT, mode: "clone" }, [])!,
    /referensi/,
  );
  assert.match(
    validateRequest({ ...DEFAULT_DRAFT, mode: "hifi", voiceId: reference.id }, [
      reference,
    ])!,
    /transkrip/,
  );
  assert.match(
    validateRequest({ ...DEFAULT_DRAFT, text: "[sad] Naskah." }, [])!,
    /tidak didukung/,
  );
  assert.match(
    validateRequest({ ...DEFAULT_DRAFT, text: "[excited] Naskah." }, [])!,
    /sintesis per segmen/,
  );
  service.updateDraft({ mode: "hifi", style: "dramatic" });
  assert.equal(snapshot().draft.style, "natural");
});

test("failure scenarios retain history and allow a new session", () => {
  for (const scenario of ["failure", "disconnected"] as const) {
    const { clock, service, snapshot } = setup();
    service.updateSettings({ scenario });
    service.generate();
    clock.advance(3000);
    assert.equal(snapshot().jobs[0].status, "failed");
    assert.equal(snapshot().jobs[0].audioUrl, null);
    assert.equal(
      snapshot().session.status,
      scenario === "failure" ? "ready" : "error",
    );
    service.updateSettings({ scenario: "normal" });
    service.startSession();
    clock.advance(2600);
    service.generate();
    clock.advance(3000);
    assert.equal(snapshot().jobs[0].status, "succeeded");
    assert.equal(snapshot().jobs[1].status, "failed");
  }
});

test("unavailable GPU does not reach model ready", () => {
  const { clock, service, snapshot } = setup(false);
  service.updateSettings({ scenario: "unavailable" });
  service.startSession();
  clock.advance(20000);
  assert.equal(snapshot().session.status, "error");
  assert.throws(() => service.generate(), /tunggu/);
});

test("reset cancels timers and clears user data while preserving examples", () => {
  const { clock, service, snapshot } = setup();
  service.addVoice(reference);
  service.generate();
  service.resetLocalData();
  clock.advance(20000);
  assert.equal(snapshot().jobs.length, 0);
  assert.equal(
    snapshot().voices.some((voice) => voice.source === "upload"),
    false,
  );
  assert.equal(snapshot().session.status, "off");
  assert.deepEqual(snapshot().draft, DEFAULT_DRAFT);
});
