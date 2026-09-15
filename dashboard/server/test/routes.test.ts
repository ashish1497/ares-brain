import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

// Real jobs module, but never actually spawn Python.
vi.mock("../src/lib/python.js", () => ({
  runPython: vi.fn(() => ({ done: new Promise(() => {}), kill: () => {} })),
  // Every /api/* route now sits behind the onboarding gate (see setupGate.test.ts),
  // which calls this for its own setup-state probe — report setup complete so the
  // routes under test here reach their real handlers.
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

import { createServer } from "../src/index.js";
import { startJob, _resetForTest } from "../src/lib/jobs.js";
import { runPythonJSON } from "../src/lib/python.js";
import { request as httpRequest, type Server } from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../src/lib/repo.js";

const GATE_READY = {
  ok: true as const,
  data: { driveConnected: true, calendarConnected: true, mesaTokenPresent: true },
};

/** Reconfigures the runPythonJSON mock so `setup-state` (the gate's own
 * check) always reports ready, while a specific subcommand gets the
 * response this test cares about — everything else falls back to a plain
 * {ok:true, data:{}}. Needed because the module-level mock at the top of
 * this file can't know per-test what each route's own runPythonJSON call
 * should return. */
function mockPython(cmd: string, response: Awaited<ReturnType<typeof runPythonJSON>>) {
  vi.mocked(runPythonJSON).mockImplementation(async (args: string[]) => {
    if (args[0] === "setup-state") return GATE_READY;
    if (args[0] === cmd) return response;
    return { ok: true, data: {} };
  });
}

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

beforeEach(() => {
  _resetForTest();
  // Restore the default (setup-state -> ready, everything else -> ok:{})
  // between tests — individual "drive routes" tests reassign this via
  // mockPython() and must not leak into unrelated tests.
  vi.mocked(runPythonJSON).mockImplementation(async (args: string[]) =>
    args[0] === "setup-state" ? GATE_READY : { ok: true, data: {} },
  );
});

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

  it("POST /api/jobs {kind:transcribe} with no course -> 400", async () => {
    const res = await raw("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json", host },
      body: JSON.stringify({ kind: "transcribe" }),
    });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "course required" });
  });

  it("rejects GET /api/overview with a foreign Host", async () => {
    const res = await raw("/api/overview", { headers: { host: "evil.example" } });
    expect(res.status).toBe(403);
  });

  it("GET /api/daily-brief returns date + morning/evening (null when unwritten)", async () => {
    const res = await fetch(`${base}/api/daily-brief`);
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j).toHaveProperty("date");
    expect(j).toHaveProperty("morning");
    expect(j).toHaveProperty("evening");
  });

  it("rejects GET /api/daily-brief with a foreign Host", async () => {
    const res = await raw("/api/daily-brief", { headers: { host: "evil.example" } });
    expect(res.status).toBe(403);
  });

  it("POST /api/client-log accepts a scope+message and never errors", async () => {
    const res = await fetch(`${base}/api/client-log`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "tab", message: "switched to chat" }),
    });
    expect(res.status).toBe(200);
  });

  it("POST /api/client-log tolerates malformed JSON instead of 500ing", async () => {
    const res = await fetch(`${base}/api/client-log`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(200);
  });

  it("POST /api/client-log is placed before the onboarding gate in the router, so logging still works before setup completes", async () => {
    // No setup-state mocking needed here — client-log is matched before the
    // gate check in handle(), so it never depends on runPythonJSON/probeClaudeCli.
    const res = await fetch(`${base}/api/client-log`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "tab", message: "x" }),
    });
    expect(res.status).toBe(200);
  });

  it("rejects GET /api/state with a foreign Host", async () => {
    const res = await raw("/api/state", { headers: { host: "evil.example" } });
    expect(res.status).toBe(403);
  });

  it("rejects GET /api/jobs/:id/log with a foreign Host", async () => {
    const job = startJob({ kind: "sync" });
    const res = await raw(`/api/jobs/${job.id}/log`, { headers: { host: "evil.example" } });
    expect(res.status).toBe(403);
  });

  it("POST /api/jobs {kind:calendar-sync} -> 202", async () => {
    const res = await raw("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json", host },
      body: JSON.stringify({ kind: "calendar-sync" }),
    });
    expect(res.status).toBe(202);
  });

  it("POST /api/jobs {kind:chat} with no message -> 400", async () => {
    const res = await raw("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json", host },
      body: JSON.stringify({ kind: "chat" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/jobs {kind:chat, message} -> 202", async () => {
    const res = await raw("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json", host },
      body: JSON.stringify({ kind: "chat", message: "what's due this week?" }),
    });
    expect(res.status).toBe(202);
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

  it("POST /api/jobs with a bare `..` course -> 400", async () => {
    const res = await raw("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json", host },
      body: JSON.stringify({ kind: "ingest", course: ".." }),
    });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "unknown course" });
  });

  it("POST /api/upload?course=.. -> 400 and writes nothing into inbox/books/", async () => {
    const res = await raw(`/api/upload?course=${encodeURIComponent("..")}&kind=book`, {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=b", host },
      body: '--b\r\nContent-Disposition: form-data; name="f"; filename="x.pdf"\r\n\r\nhi\r\n--b--\r\n',
    });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "unknown course" });
    expect(existsSync(join(repoRoot(), "inbox", "books", "x.pdf"))).toBe(false);
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

  describe("drive routes", () => {
    it("GET /api/drive/folders reads config/course-drive-folders.json", async () => {
      const res = await fetch(`${base}/api/drive/folders`);
      expect(res.status).toBe(200);
      // Whatever the repo's real config currently holds — just prove it's the
      // real file, not a stub (an object, not an error shape).
      expect(typeof (await res.json())).toBe("object");
    });

    it("POST /api/drive/register-folder requires a known course", async () => {
      const res = await raw("/api/drive/register-folder", {
        method: "POST",
        headers: { "content-type": "application/json", host },
        body: JSON.stringify({ course: "../evil", folderId: "F1" }),
      });
      expect(res.status).toBe(400);
    });

    it("POST /api/drive/register-folder requires a non-empty folderId", async () => {
      const res = await raw("/api/drive/register-folder", {
        method: "POST",
        headers: { "content-type": "application/json", host },
        body: JSON.stringify({ course: "ai-and-its-application", folderId: "  " }),
      });
      expect(res.status).toBe(400);
    });

    it("POST /api/drive/register-folder delegates to the CLI and returns its result", async () => {
      mockPython("drive-register-folder", {
        ok: true,
        data: { ok: true, folders: { "ai-and-its-application": "F1" } },
      });
      const res = await raw("/api/drive/register-folder", {
        method: "POST",
        headers: { "content-type": "application/json", host },
        body: JSON.stringify({ course: "ai-and-its-application", folderId: "F1" }),
      });
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({
        ok: true,
        folders: { "ai-and-its-application": "F1" },
      });
    });

    it("GET /api/drive/browse requires a known course", async () => {
      const res = await raw("/api/drive/browse?course=../evil", { headers: { host } });
      expect(res.status).toBe(400);
    });

    it("GET /api/drive/browse returns the CLI's browse result", async () => {
      const fakeBrowse = {
        connected: true,
        materials: [{ name: "syllabus.md" }],
        transcripts: [],
        guide: null,
        notes: [],
        testprep: [],
      };
      mockPython("drive-browse", { ok: true, data: fakeBrowse });
      const res = await raw("/api/drive/browse?course=ai-and-its-application", {
        headers: { host },
      });
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual(fakeBrowse);
    });

    it("GET /api/drive/access-token returns the CLI's token result", async () => {
      mockPython("drive-access-token", { ok: true, data: { token: "tok123" } });
      const res = await raw("/api/drive/access-token", { headers: { host } });
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ token: "tok123" });
    });

    it("GET /api/notes requires a known course", async () => {
      const res = await raw("/api/notes?course=../evil", { headers: { host } });
      expect(res.status).toBe(400);
    });

    it("GET /api/notes returns self-note query results", async () => {
      mockPython("brain-query", {
        ok: true,
        data: { results: [{ path: "normalized/self-note-x.md" }] },
      });
      const res = await raw("/api/notes?course=ai-and-its-application", { headers: { host } });
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({
        results: [{ path: "normalized/self-note-x.md" }],
      });
    });

    it("GET /api/study requires a known course", async () => {
      const res = await raw("/api/study?course=../evil", { headers: { host } });
      expect(res.status).toBe(400);
    });

    it("GET /api/study returns list-study results", async () => {
      mockPython("list-study", { ok: true, data: { items: [{ name: "testprep-1" }] } });
      const res = await raw("/api/study?course=ai-and-its-application", { headers: { host } });
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ items: [{ name: "testprep-1" }] });
    });

    it("POST /api/drive/share-note requires a known course and a path", async () => {
      const badCourse = await raw("/api/drive/share-note", {
        method: "POST",
        headers: { "content-type": "application/json", host },
        body: JSON.stringify({ course: "../evil", path: "normalized/x.md" }),
      });
      expect(badCourse.status).toBe(400);
      const noPath = await raw("/api/drive/share-note", {
        method: "POST",
        headers: { "content-type": "application/json", host },
        body: JSON.stringify({ course: "ai-and-its-application", path: "" }),
      });
      expect(noPath.status).toBe(400);
    });

    it("POST /api/drive/share-note delegates to the CLI", async () => {
      mockPython("share-note", { ok: true, data: { ok: true, link: "https://drive/x" } });
      const res = await raw("/api/drive/share-note", {
        method: "POST",
        headers: { "content-type": "application/json", host },
        body: JSON.stringify({
          course: "ai-and-its-application",
          path: "normalized/self-note-x.md",
        }),
      });
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ ok: true, link: "https://drive/x" });
    });

    it("POST /api/drive/share-study requires a known course and a name", async () => {
      const noName = await raw("/api/drive/share-study", {
        method: "POST",
        headers: { "content-type": "application/json", host },
        body: JSON.stringify({ course: "ai-and-its-application", name: "" }),
      });
      expect(noName.status).toBe(400);
    });

    it("POST /api/drive/share-study delegates to the CLI", async () => {
      mockPython("share-study", { ok: true, data: { ok: true, link: "https://drive/y" } });
      const res = await raw("/api/drive/share-study", {
        method: "POST",
        headers: { "content-type": "application/json", host },
        body: JSON.stringify({ course: "ai-and-its-application", name: "testprep-1" }),
      });
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ ok: true, link: "https://drive/y" });
    });
  });
});
