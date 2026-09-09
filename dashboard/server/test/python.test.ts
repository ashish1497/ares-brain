import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

// runPythonJSON shells out via node:child_process spawn and checks the venv
// exists — stub both so the parse / exit / timeout branches can be exercised
// without a real Python.
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("node:fs", () => ({ existsSync: vi.fn(() => true) }));
vi.mock("../src/lib/repo.js", () => ({
  repoRoot: () => "/repo",
  venvPython: () => "/repo/scraper/.venv/bin/python",
}));

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { runPythonJSON } from "../src/lib/python.js";

const spawnMock = vi.mocked(spawn);
const existsMock = vi.mocked(existsSync);

interface FakeChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
}

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  spawnMock.mockReturnValue(child as unknown as ReturnType<typeof spawn>);
  return child;
}

beforeEach(() => {
  vi.clearAllMocks();
  existsMock.mockReturnValue(true);
});

describe("runPythonJSON", () => {
  it("parses the last {-line of stdout on exit 0", async () => {
    const child = fakeChild();
    const p = runPythonJSON(["overview", "--json"]);
    child.stdout.emit("data", Buffer.from('noise\n{"ok":1}\n'));
    child.emit("close", 0);
    expect(await p).toEqual({ ok: true, data: { ok: 1 } });
  });

  it("returns the stderr tail on a non-zero exit", async () => {
    const child = fakeChild();
    const p = runPythonJSON(["overview", "--json"]);
    child.stderr.emit("data", Buffer.from("boom: traceback"));
    child.emit("close", 1);
    expect(await p).toEqual({ ok: false, error: "boom: traceback" });
  });

  it("fails when stdout carries no {-line even on exit 0", async () => {
    const child = fakeChild();
    const p = runPythonJSON(["overview", "--json"]);
    child.stdout.emit("data", Buffer.from("just some log lines\n"));
    child.emit("close", 0);
    expect((await p).ok).toBe(false);
  });

  it("kills the child and reports a timeout when it never closes", async () => {
    const child = fakeChild();
    const r = await runPythonJSON(["overview", "--json"], 20);
    expect(r).toEqual({ ok: false, error: "timeout" });
    expect(child.kill).toHaveBeenCalled();
  });

  it("short-circuits to {ok:false} when the venv is missing", async () => {
    existsMock.mockReturnValue(false);
    const r = await runPythonJSON(["overview", "--json"]);
    expect(r.ok).toBe(false);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
