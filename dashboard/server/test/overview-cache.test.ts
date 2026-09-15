import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({
  root: "",
  runPythonJSON: vi.fn(),
}));

vi.mock("../src/lib/python.js", () => ({
  runPython: vi.fn(() => ({ done: new Promise(() => {}), kill: () => {} })),
  runPythonJSON: (...a: unknown[]) => mocks.runPythonJSON(...a),
}));
vi.mock("../src/lib/repo.js", () => ({
  repoRoot: () => mocks.root,
  venvPython: () => join(mocks.root, "scraper", ".venv", "bin", "python"),
}));
// The onboarding gate now runs in front of GET /api/overview too, and would
// otherwise spawn a real `claude -p` subprocess on every request.
vi.mock("../src/lib/claudeProbe.js", () => ({
  probeClaudeCli: vi.fn(() => Promise.resolve(true)),
}));

import { createServer } from "../src/index.js";
import type { Server } from "node:http";

let server: Server;
let base: string;
let root: string;
let cache: string;

beforeAll(async () => {
  server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as any).port;
  base = `http://127.0.0.1:${port}`;
  process.env.ARES_BRAIN_DASHBOARD_PORT = String(port);
  // Warm the gate's setup-state cache once, before any per-test mock resets, so
  // the assertions below about mocks.runPythonJSON call counts reflect only the
  // /api/overview handler's own spawns — not the gate's setup-state probe.
  mocks.runPythonJSON.mockResolvedValue({
    ok: true,
    data: { driveConnected: true, calendarConnected: true, mesaTokenPresent: true },
  });
  await fetch(`${base}/api/__warm_gate_cache__`);
});
afterAll(() => {
  delete process.env.ARES_BRAIN_DASHBOARD_PORT;
  return new Promise<void>((r) => server.close(() => r()));
});
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ares-ovcache-"));
  mkdirSync(join(root, "courses"), { recursive: true });
  mocks.root = root;
  cache = join(root, "courses", "_overview.json");
  mocks.runPythonJSON.mockReset();
  // Filter by args[0] rather than blanket-mocking every call to the overview
  // payload shape: the 10s gate cache (GATE_CACHE_MS) can expire mid-run and
  // re-probe setup-state, and a setup-state call answered with the overview
  // shape misreads driveConnected/etc as undefined — flipping ready to false
  // and turning unrelated assertions in this file into spurious 503s. Mirrors
  // the pattern in overview.test.ts.
  mocks.runPythonJSON.mockImplementation((args: string[]) => {
    if (args[0] === "setup-state") {
      return Promise.resolve({
        ok: true,
        data: { driveConnected: true, calendarConnected: true, mesaTokenPresent: true },
      });
    }
    return Promise.resolve({ ok: true, data: { kpis: { fromSpawn: true } } });
  });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("GET /api/overview cache", () => {
  it("serves a fresh cache file without spawning Python", async () => {
    writeFileSync(cache, JSON.stringify({ kpis: { fromCache: true } }));
    const r = await fetch(`${base}/api/overview`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ kpis: { fromCache: true } });
    expect(mocks.runPythonJSON).not.toHaveBeenCalled();
  });

  it("spawns Python when the cache file is missing", async () => {
    const r = await fetch(`${base}/api/overview`);
    expect(await r.json()).toEqual({ kpis: { fromSpawn: true } });
    expect(mocks.runPythonJSON).toHaveBeenCalledWith(["overview", "--json"]);
  });

  it("spawns Python when the cache file is stale (mtime > 120s)", async () => {
    writeFileSync(cache, JSON.stringify({ kpis: { fromCache: true } }));
    const old = Date.now() / 1000 - 300;
    utimesSync(cache, old, old);
    await fetch(`${base}/api/overview`);
    expect(mocks.runPythonJSON).toHaveBeenCalled();
  });

  it("spawns Python on a malformed cache file", async () => {
    writeFileSync(cache, "{ not json");
    const r = await fetch(`${base}/api/overview`);
    expect(await r.json()).toEqual({ kpis: { fromSpawn: true } });
    expect(mocks.runPythonJSON).toHaveBeenCalled();
  });

  it("?fresh=1 always spawns Python even with a fresh cache", async () => {
    writeFileSync(cache, JSON.stringify({ kpis: { fromCache: true } }));
    const r = await fetch(`${base}/api/overview?fresh=1`);
    expect(await r.json()).toEqual({ kpis: { fromSpawn: true } });
    expect(mocks.runPythonJSON).toHaveBeenCalledWith(["overview", "--json"]);
  });
});
