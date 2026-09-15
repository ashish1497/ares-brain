import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../src/lib/python.js", () => ({
  runPython: vi.fn(),
  // The onboarding gate now runs in front of GET /api/jobs/:id/log too — report
  // setup complete so this test reaches the real SSE handler.
  runPythonJSON: vi.fn(() =>
    Promise.resolve({
      ok: true,
      data: { driveConnected: true, calendarConnected: true, mesaTokenPresent: true },
    }),
  ),
}));
vi.mock("../src/lib/claudeProbe.js", () => ({
  probeClaudeCli: vi.fn(() => Promise.resolve(true)),
}));
import { runPython } from "../src/lib/python.js";
import { createServer } from "../src/index.js";
import { startJob, _listenerCounts, _resetForTest } from "../src/lib/jobs.js";
import type { Server } from "node:http";

function fakeRun() {
  let finish: (c: { code: number }) => void = () => {};
  let push: (l: string) => void = () => {};
  (runPython as any).mockImplementation((_argv: string[], cb: (l: string) => void) => {
    push = cb;
    return { done: new Promise((r) => (finish = r)), kill: () => {} };
  });
  return {
    finish: (code: number) => finish({ code }),
    emit: (l: string) => push(l),
  };
}

let server: Server;
let base: string;

beforeEach(async () => {
  vi.clearAllMocks();
  _resetForTest();
  server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as any).port;
  base = `http://127.0.0.1:${port}`;
  // GET /api/jobs/:id/log is now behind the same-origin Host guard (see M3 of the final
  // fix wave) — the guard checks against ARES_BRAIN_DASHBOARD_PORT, so it must match the
  // ephemeral port this server actually bound to, or every request here 403s.
  process.env.ARES_BRAIN_DASHBOARD_PORT = String(port);
});
afterEach(() => {
  delete process.env.ARES_BRAIN_DASHBOARD_PORT;
  (server as any).closeAllConnections?.();
  return new Promise<void>((r) => server.close(() => r()));
});

describe("SSE /api/jobs/:id/log", () => {
  it("removes its bus listeners when the job ends while a client is attached", async () => {
    const f1 = fakeRun();
    const id = startJob({ kind: "sync" }).id;
    f1.emit("hello"); // ensure the SSE replay flushes a byte so fetch() resolves

    const res = await fetch(`${base}/api/jobs/${id}/log`);
    const reader = res.body!.getReader();
    await reader.read();
    await new Promise((r) => setTimeout(r, 20));
    expect(_listenerCounts()).toEqual({ line: 1, end: 1 });

    f1.finish(0);
    await new Promise((r) => setTimeout(r, 20));

    // the ended request must have detached both listeners...
    expect(_listenerCounts()).toEqual({ line: 0, end: 0 });

    // ...so a second job's emissions never write to the dead response.
    const f2 = fakeRun();
    expect(() => startJob({ kind: "ingest", course: "c1" })).not.toThrow();
    f2.finish(0);
    await new Promise((r) => setTimeout(r, 20));
    await reader.cancel().catch(() => {});
  });
});
