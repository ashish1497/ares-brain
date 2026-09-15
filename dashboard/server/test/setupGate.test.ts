import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../src/lib/python.js", async () => {
  const actual =
    await vi.importActual<typeof import("../src/lib/python.js")>("../src/lib/python.js");
  return { ...actual, runPythonJSON: vi.fn() };
});
vi.mock("../src/lib/claudeProbe.js", () => ({ probeClaudeCli: vi.fn() }));
vi.mock("../src/lib/jobs.js", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/jobs.js")>("../src/lib/jobs.js");
  return { ...actual, currentJob: vi.fn(actual.currentJob) };
});

import { createServer, _resetGateCacheForTest, _expireGateCacheForTest } from "../src/index.js";
import { runPythonJSON } from "../src/lib/python.js";
import { probeClaudeCli } from "../src/lib/claudeProbe.js";
import { currentJob } from "../src/lib/jobs.js";
import type { Server } from "node:http";

let server: Server;
let base: string;

beforeEach(async () => {
  vi.clearAllMocks();
  _resetGateCacheForTest();
  server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as any).port;
  base = `http://127.0.0.1:${port}`;
  // /api/state and other state-changing-ish routes run guardOrigin, which checks the
  // Host header against this port.
  process.env.ARES_BRAIN_DASHBOARD_PORT = String(port);
});

afterEach(() => {
  delete process.env.ARES_BRAIN_DASHBOARD_PORT;
  return new Promise<void>((r) => server.close(() => r()));
});

describe("setup gate", () => {
  it("GET /api/setup-state reports ready:false when anything is incomplete", async () => {
    (runPythonJSON as any).mockResolvedValue({
      ok: true,
      data: { driveConnected: false, calendarConnected: true, mesaTokenPresent: true },
    });
    (probeClaudeCli as any).mockResolvedValue(true);
    const res = await fetch(`${base}/api/setup-state`);
    const j = await res.json();
    expect(j.ready).toBe(false);
    expect(j.driveConnected).toBe(false);
  });

  it("GET /api/setup-state reports ready:true when all four pass", async () => {
    (runPythonJSON as any).mockResolvedValue({
      ok: true,
      data: { driveConnected: true, calendarConnected: true, mesaTokenPresent: true },
    });
    (probeClaudeCli as any).mockResolvedValue(true);
    const res = await fetch(`${base}/api/setup-state`);
    expect((await res.json()).ready).toBe(true);
  });

  it("blocks GET /api/courses with 503 while setup is incomplete", async () => {
    (runPythonJSON as any).mockResolvedValue({
      ok: true,
      data: { driveConnected: false, calendarConnected: false, mesaTokenPresent: false },
    });
    (probeClaudeCli as any).mockResolvedValue(false);
    const res = await fetch(`${base}/api/courses`);
    expect(res.status).toBe(503);
  });

  it("allows GET /api/courses through once setup is complete", async () => {
    (runPythonJSON as any).mockResolvedValue({
      ok: true,
      data: { driveConnected: true, calendarConnected: true, mesaTokenPresent: true },
    });
    (probeClaudeCli as any).mockResolvedValue(true);
    const res = await fetch(`${base}/api/courses`);
    expect(res.status).toBe(200);
  });

  it("caches the gate check across gated routes within the TTL, skipping repeat probes", async () => {
    (runPythonJSON as any).mockResolvedValue({
      ok: true,
      data: { driveConnected: true, calendarConnected: true, mesaTokenPresent: true },
    });
    (probeClaudeCli as any).mockResolvedValue(true);

    const r1 = await fetch(`${base}/api/courses`);
    const r2 = await fetch(`${base}/api/state`);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    // Both requests were gated, but the expensive checks (python spawn + claude
    // CLI probe) must only run once thanks to the gate cache.
    expect(runPythonJSON).toHaveBeenCalledTimes(1);
    expect(probeClaudeCli).toHaveBeenCalledTimes(1);
  });

  it("I3: refreshes the gate cache from GET /api/setup-state so a gated route doesn't 503 on stale cache", async () => {
    // Seed a stale negative gate cache, as if setup wasn't done a moment ago.
    (runPythonJSON as any).mockResolvedValue({
      ok: true,
      data: { driveConnected: false, calendarConnected: false, mesaTokenPresent: false },
    });
    (probeClaudeCli as any).mockResolvedValue(false);
    const seed = await fetch(`${base}/api/courses`);
    expect(seed.status).toBe(503); // gate cache is now negative

    // Setup finishes; the setup-state poll (what SetupGate uses to flip to ready:true)
    // now sees everything pass.
    (runPythonJSON as any).mockResolvedValue({
      ok: true,
      data: { driveConnected: true, calendarConnected: true, mesaTokenPresent: true },
    });
    (probeClaudeCli as any).mockResolvedValue(true);
    const state = await fetch(`${base}/api/setup-state`);
    expect((await state.json()).ready).toBe(true);

    // The very next gated call must reflect that fresh state immediately —
    // not the stale negative gate cache from up to GATE_CACHE_MS (10s) ago.
    const res = await fetch(`${base}/api/courses`);
    expect(res.status).toBe(200);
  });

  it("skips re-probing while a job is running, trusting the last known state instead", async () => {
    (runPythonJSON as any).mockResolvedValue({
      ok: true,
      data: { driveConnected: true, calendarConnected: true, mesaTokenPresent: true },
    });
    (probeClaudeCli as any).mockResolvedValue(true);

    // Establish a good gate cache first (idle — no job running yet).
    const first = await fetch(`${base}/api/courses`);
    expect(first.status).toBe(200);
    expect(probeClaudeCli).toHaveBeenCalledTimes(1);

    // Now simulate a job running — as if a real `claude -p` chat job is
    // mid-flight — and force the cache to look expired so a naive
    // implementation would re-probe.
    (currentJob as any).mockReturnValue({ status: "running" });
    _expireGateCacheForTest();

    // A second gated call must NOT spawn a second probe (which would
    // contend with the running job's own `claude` process and can
    // false-negative under load) — it should reuse the last known state.
    const second = await fetch(`${base}/api/state`);
    expect(second.status).toBe(200);
    expect(probeClaudeCli).toHaveBeenCalledTimes(1);
  });

  it("re-probes once idle, even right after skipping while a job was running", async () => {
    (runPythonJSON as any).mockResolvedValue({
      ok: true,
      data: { driveConnected: true, calendarConnected: true, mesaTokenPresent: true },
    });
    (probeClaudeCli as any).mockResolvedValue(true);

    await fetch(`${base}/api/courses`);
    expect(probeClaudeCli).toHaveBeenCalledTimes(1);

    (currentJob as any).mockReturnValue(null); // idle
    _expireGateCacheForTest();

    await fetch(`${base}/api/state`);
    expect(probeClaudeCli).toHaveBeenCalledTimes(2);
  });

  it("single-flights concurrent setup-state checks instead of spawning a probe per request", async () => {
    // Reproduces the live thundering-herd bug: several requests landing on a
    // cold/expired cache in the same instant must share ONE underlying probe,
    // not spawn one each (which was observed live as 5 concurrent `claude -p`
    // processes contending for resources and one genuinely timing out).
    (runPythonJSON as any).mockResolvedValue({
      ok: true,
      data: { driveConnected: true, calendarConnected: true, mesaTokenPresent: true },
    });
    let resolveProbe!: (v: boolean) => void;
    (probeClaudeCli as any).mockReturnValue(
      new Promise((res) => {
        resolveProbe = res;
      }),
    );

    // Three concurrent requests, all hitting a cold cache before the first
    // one's probe has resolved.
    const requests = [
      fetch(`${base}/api/setup-state`),
      fetch(`${base}/api/setup-state`),
      fetch(`${base}/api/state`),
    ];
    // Let them all actually start before resolving the shared probe.
    await new Promise((r) => setTimeout(r, 10));
    resolveProbe(true);
    const results = await Promise.all(requests);
    expect(results.every((r) => r.status === 200)).toBe(true);

    expect(probeClaudeCli).toHaveBeenCalledTimes(1);
    expect(runPythonJSON).toHaveBeenCalledTimes(1);
  });

  it("never serves GET /api/setup-state itself from the gate cache", async () => {
    (runPythonJSON as any).mockResolvedValue({
      ok: true,
      data: { driveConnected: true, calendarConnected: true, mesaTokenPresent: true },
    });
    (probeClaudeCli as any).mockResolvedValue(true);

    await fetch(`${base}/api/setup-state`);
    await fetch(`${base}/api/setup-state`);

    // The setup-state endpoint is what the setup screen polls to watch live
    // progress — it must always compute fresh, never reuse the gate cache.
    expect(runPythonJSON).toHaveBeenCalledTimes(2);
    expect(probeClaudeCli).toHaveBeenCalledTimes(2);
  });
});
