import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/lib/python.js", () => ({
  runPython: vi.fn(),
}));
import { runPython } from "../src/lib/python.js";
import { startJob, currentJob, onLine, BusyError, _resetForTest } from "../src/lib/jobs.js";

function fakeRun() {
  let emit: (l: string) => void = () => {};
  let finish: (c: { code: number }) => void = () => {};
  (runPython as any).mockImplementation((_a: string[], cb: (l: string) => void) => {
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
    const job = startJob({ kind: "sync" });
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

  it("failed exit -> status failed", async () => {
    const f = fakeRun();
    startJob({ kind: "ingest", course: "c1" });
    f.finish(2);
    await new Promise((r) => setTimeout(r, 0));
    expect(currentJob()!.status).toBe("failed");
    expect(currentJob()!.exitCode).toBe(2);
  });
});
