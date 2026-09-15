import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/lib/python.js", () => ({
  runPython: vi.fn(),
}));
vi.mock("../src/lib/claudeRunner.js", () => ({
  runClaude: vi.fn(),
}));
import { runPython } from "../src/lib/python.js";
import { runClaude } from "../src/lib/claudeRunner.js";
import { startJob, currentJob, lastRunMap, BusyError, _resetForTest } from "../src/lib/jobs.js";

function fakeRun() {
  let emit: (l: string) => void = () => {};
  let finish: (c: { code: number }) => void = () => {};
  (runPython as any).mockImplementation((_a: string[], cb: (l: string) => void) => {
    emit = cb;
    return { done: new Promise((r) => (finish = r)), kill: () => {} };
  });
  return { emit: (l: string) => emit(l), finish: (code: number) => finish({ code }) };
}

function fakeClaudeRun() {
  let emit: (l: string) => void = () => {};
  let finish: (c: { code: number }) => void = () => {};
  (runClaude as any).mockImplementation((_m: string, cb: (l: string) => void) => {
    emit = cb;
    return { done: new Promise((r) => (finish = r)), kill: () => {} };
  });
  return { emit: (l: string) => emit(l), finish: (code: number) => finish({ code }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetForTest();
});

describe("jobs", () => {
  it("builds argv per kind and streams lines", async () => {
    const f = fakeRun();
    startJob({ kind: "sync" });
    expect((runPython as any).mock.calls[0][0]).toEqual(["all"]);
    f.emit("line one");
    expect(currentJob()!.log).toContain("line one");
    f.finish(0);
    await new Promise((r) => setTimeout(r, 0));
    expect(currentJob()!.status).toBe("done");
  });

  it("rejects a second job while running", () => {
    fakeRun();
    startJob({ kind: "sync" });
    expect(() => startJob({ kind: "ingest" })).toThrow(BusyError);
  });

  it("calendar-sync argv", () => {
    fakeRun();
    startJob({ kind: "calendar-sync" });
    expect((runPython as any).mock.calls[0][0]).toEqual(["calendar-sync"]);
  });

  it("transcribe-url argv", () => {
    fakeRun();
    startJob({ kind: "transcribe-url", course: "c1", url: "u", title: "t" });
    expect((runPython as any).mock.calls[0][0]).toEqual([
      "transcribe-url",
      "--course",
      "c1",
      "--url",
      "u",
      "--title",
      "t",
      "--json",
    ]);
  });

  it("transcribe-inbox argv", () => {
    fakeRun();
    startJob({ kind: "transcribe-inbox", course: "c1" });
    expect((runPython as any).mock.calls[0][0]).toEqual([
      "transcribe",
      "--course",
      "c1",
      "--inbox",
      "--json",
    ]);
  });

  it("transcribe argv", () => {
    fakeRun();
    startJob({ kind: "transcribe", course: "c1" });
    expect((runPython as any).mock.calls[0][0]).toEqual(["transcribe", "--course", "c1", "--json"]);
  });

  it("ingest --course argv", () => {
    fakeRun();
    startJob({ kind: "ingest", course: "c1" });
    expect((runPython as any).mock.calls[0][0]).toEqual(["ingest", "--course", "c1"]);
  });

  it("populates lastRuns[kind] after completion and allows a new job once done", async () => {
    const f = fakeRun();
    startJob({ kind: "sync" });
    expect(() => startJob({ kind: "ingest", course: "c1" })).toThrow(BusyError);
    f.finish(0);
    await new Promise((r) => setTimeout(r, 0));
    expect(lastRunMap().sync).toMatchObject({ exitCode: 0 });
    expect(lastRunMap().sync.finishedAt).toEqual(expect.any(String));
    const f2 = fakeRun();
    expect(() => startJob({ kind: "ingest", course: "c1" })).not.toThrow();
    f2.finish(0);
    await new Promise((r) => setTimeout(r, 0));
  });

  it("chat kind spawns via runClaude, not runPython", () => {
    fakeClaudeRun();
    const job = startJob({ kind: "chat", message: "what's due?" });
    expect(job.kind).toBe("chat");
    expect((runClaude as any).mock.calls[0][0]).toBe("what's due?");
    expect(runPython).not.toHaveBeenCalled();
  });

  it("failed exit -> status failed", async () => {
    const f = fakeRun();
    startJob({ kind: "ingest", course: "c1" });
    f.finish(2);
    await new Promise((r) => setTimeout(r, 0));
    expect(currentJob()!.status).toBe("failed");
    expect(currentJob()!.exitCode).toBe(2);
  });
});
