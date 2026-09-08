import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

// Real jobs module, but never actually spawn Python.
vi.mock("../src/lib/python.js", () => ({
  runPython: vi.fn(() => ({ done: new Promise(() => {}), kill: () => {} })),
}));

import { createServer } from "../src/index.js";
import { _resetForTest } from "../src/lib/jobs.js";
import { request as httpRequest, type Server } from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../src/lib/repo.js";

let server: Server;
let base: string;
let host: string;
let port: number;

/** Raw request so we control the exact Host/Origin headers (undici's fetch rewrites them). */
function raw(
  path: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, path, method: opts.method ?? "GET", headers: opts.headers },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: b }));
      },
    );
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

beforeAll(async () => {
  server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const a = server.address() as any;
  port = a.port;
  base = `http://127.0.0.1:${a.port}`;
  host = `127.0.0.1:${a.port}`;
  process.env.ARES_BRAIN_DASHBOARD_PORT = String(a.port);
});
afterAll(() => {
  delete process.env.ARES_BRAIN_DASHBOARD_PORT;
  return new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => _resetForTest());

describe("routes", () => {
  it("GET /api/courses returns an array", async () => {
    const res = await fetch(`${base}/api/courses`);
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  it("GET /api/state has job + lastRuns keys", async () => {
    const j = await (await fetch(`${base}/api/state`)).json();
    expect(j).toHaveProperty("job");
    expect(j).toHaveProperty("lastRuns");
  });

  it("POST /api/jobs with a bogus kind -> 400", async () => {
    const res = await fetch(`${base}/api/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "nope" }),
    });
    expect(res.status).toBe(400);
  });

  it("unknown path -> 404 (api) ", async () => {
    expect((await fetch(`${base}/api/nope`)).status).toBe(404);
  });

  it("POST /api/jobs with a cross-origin Host -> 403", async () => {
    const res = await raw("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json", host: "evil.com" },
      body: JSON.stringify({ kind: "sync" }),
    });
    expect(res.status).toBe(403);
  });

  it("POST /api/jobs with a cross-origin Origin -> 403", async () => {
    const res = await raw("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json", host, origin: "http://evil.com" },
      body: JSON.stringify({ kind: "sync" }),
    });
    expect(res.status).toBe(403);
  });

  it("POST /api/jobs allows the Vite dev origin", async () => {
    const res = await raw("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json", host, origin: "http://localhost:5173" },
      body: JSON.stringify({ kind: "sync" }),
    });
    expect(res.status).toBe(202);
  });

  it("POST /api/jobs {kind:sync} -> 202 {jobId}; a 2nd while running -> 409", async () => {
    const ok = await raw("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json", host },
      body: JSON.stringify({ kind: "sync" }),
    });
    expect(ok.status).toBe(202);
    expect(JSON.parse(ok.body)).toHaveProperty("jobId");
    const busy = await raw("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json", host },
      body: JSON.stringify({ kind: "sync" }),
    });
    expect(busy.status).toBe(409);
  });

  it("POST /api/jobs with a traversal course -> 400", async () => {
    const res = await raw("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json", host },
      body: JSON.stringify({ kind: "ingest", course: "../evil" }),
    });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "unknown course" });
  });

  it("POST /api/upload?course=../evil -> 400 and writes nothing outside courses/", async () => {
    const res = await raw(`/api/upload?course=${encodeURIComponent("../evil")}&kind=book`, {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=b", host },
      body: '--b\r\nContent-Disposition: form-data; name="f"; filename="x.pdf"\r\n\r\nhi\r\n--b--\r\n',
    });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "unknown course" });
    expect(existsSync(join(repoRoot(), "evil"))).toBe(false);
  });
});
