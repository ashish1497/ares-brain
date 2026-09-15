import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../src/lib/python.js", async () => {
  const actual =
    await vi.importActual<typeof import("../src/lib/python.js")>("../src/lib/python.js");
  return { ...actual, runPythonJSON: vi.fn() };
});
vi.mock("../src/lib/claudeProbe.js", () => ({ probeClaudeCli: vi.fn() }));

import { createServer, _resetGateCacheForTest } from "../src/index.js";
import { runPythonJSON } from "../src/lib/python.js";
import { probeClaudeCli } from "../src/lib/claudeProbe.js";
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
