import { createServer as httpCreate, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, sep } from "node:path";
import { match } from "./lib/router.js";
import { readCourses } from "./lib/courses.js";
import { receiveUpload, courseSlugOk } from "./lib/upload.js";
import { repoRoot } from "./lib/repo.js";
import { readDailyBrief } from "./lib/dailyBrief.js";
import { runPythonJSON } from "./lib/python.js";
import { probeClaudeCli } from "./lib/claudeProbe.js";
import { guardOrigin } from "./lib/origin.js";
import { handleOutreachRoute } from "./lib/outreachRoutes.js";
import {
  startJob,
  currentJob,
  lastRunMap,
  onLine,
  onEnd,
  killCurrent,
  BusyError,
  type JobKind,
} from "./lib/jobs.js";

const KINDS: JobKind[] = [
  "sync",
  "calendar-sync",
  "ingest",
  "transcribe",
  "transcribe-url",
  "transcribe-inbox",
  "chat",
];
const WEB_DIST = join(repoRoot(), "dashboard", "web", "dist");
const OVERVIEW_CACHE_MAX_AGE_MS = 120_000;
const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

export { guardOrigin };

/** `course` must be a plain slug and (once synced) a real course slug. */
function courseAllowed(course: string): boolean {
  if (!courseSlugOk(course)) return false;
  const slugs = readCourses().map((c) => c.slug);
  return slugs.length === 0 ? true : slugs.includes(course);
}

function json(res: ServerResponse, code: number, body: unknown) {
  const s = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(s),
  });
  res.end(s);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function getSetupState() {
  const py = await runPythonJSON(["setup-state", "--json"]);
  const base = py.ok
    ? (py.data as {
        driveConnected: boolean;
        calendarConnected: boolean;
        mesaTokenPresent: boolean;
      })
    : { driveConnected: false, calendarConnected: false, mesaTokenPresent: false };
  const claudeCliLoggedIn = await probeClaudeCli();
  const ready =
    base.driveConnected && base.calendarConnected && base.mesaTokenPresent && claudeCliLoggedIn;
  return { ...base, claudeCliLoggedIn, ready };
}

// Short-lived cache for the blanket API gate only — NOT for the GET /api/setup-state
// endpoint itself, which must always compute fresh (it's what the setup screen polls
// to watch live progress). Without this cache, every /api/* request — including
// frequent polls like GET /api/overview every 20s — would spawn a `claude -p` probe
// process (up to a 5s timeout) forever, even once setup is complete.
let gateCache: { state: Awaited<ReturnType<typeof getSetupState>>; at: number } | null = null;
const GATE_CACHE_MS = 10_000;

async function gatedSetupState() {
  if (gateCache && Date.now() - gateCache.at < GATE_CACHE_MS) return gateCache.state;
  const state = await getSetupState();
  gateCache = { state, at: Date.now() };
  return state;
}

/** Test-only: clear the gate cache so tests don't leak state across cases. */
export function _resetGateCacheForTest() {
  gateCache = null;
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = req.url ?? "/";
  const method = req.method ?? "GET";

  if (match("GET", "/api/setup-state", method, url)) {
    const state = await getSetupState();
    // Also refresh the gate cache with this fresh read so the very first
    // successful load right after setup completes doesn't still see a stale
    // cached ready:false on the next /api/* call (up to GATE_CACHE_MS later).
    gateCache = { state, at: Date.now() };
    return json(res, 200, state);
  }

  // Gate: every other /api/* route requires setup to be complete.
  if (url.startsWith("/api/")) {
    const state = await gatedSetupState();
    if (!state.ready) return json(res, 503, { error: "setup incomplete", setupState: state });
  }

  if (match("GET", "/api/courses", method, url)) return json(res, 200, readCourses());

  if (match("GET", "/api/state", method, url)) {
    const bad = guardOrigin(req);
    if (bad) return json(res, 403, { error: bad });
    return json(res, 200, { job: currentJob(), lastRuns: lastRunMap() });
  }

  if (match("GET", "/api/overview", method, url)) {
    const bad = guardOrigin(req);
    if (bad) return json(res, 403, { error: bad });
    const fresh = new URL(url, "http://x").searchParams.get("fresh") === "1";
    if (!fresh) {
      try {
        const cacheFile = join(repoRoot(), "courses", "_overview.json");
        const age = Date.now() - (await stat(cacheFile)).mtimeMs;
        if (age < OVERVIEW_CACHE_MAX_AGE_MS) {
          const cached = JSON.parse(await readFile(cacheFile, "utf8"));
          return json(res, 200, cached);
        }
      } catch {
        /* missing / stale / malformed cache → fall through to a fresh spawn */
      }
    }
    const r = await runPythonJSON(["overview", "--json"]);
    return r.ok ? json(res, 200, r.data) : json(res, 503, { error: r.error });
  }

  if (match("GET", "/api/daily-brief", method, url)) {
    const bad = guardOrigin(req);
    if (bad) return json(res, 403, { error: bad });
    const date = new URL(url, "http://x").searchParams.get("date");
    return json(res, 200, await readDailyBrief(date));
  }

  if (url.startsWith("/api/outreach/")) {
    if (method === "POST") {
      const bad = guardOrigin(req);
      if (bad) return json(res, 403, { error: bad });
    }
    const handled = await handleOutreachRoute(req, res, method, url);
    if (handled) return;
  }

  if (match("POST", "/api/jobs", method, url)) {
    const bad = guardOrigin(req);
    if (bad) return json(res, 403, { error: bad });
    let b: any;
    try {
      b = JSON.parse(await readBody(req));
    } catch {
      return json(res, 400, { error: "bad json" });
    }
    if (!KINDS.includes(b?.kind)) return json(res, 400, { error: "unknown kind" });
    if (
      (b.kind === "transcribe" || b.kind === "transcribe-url" || b.kind === "transcribe-inbox") &&
      !b.course
    )
      return json(res, 400, { error: "course required" });
    if (b.kind === "transcribe-url" && !b.url) return json(res, 400, { error: "url required" });
    if (b.kind === "chat" && !String(b.message ?? "").trim())
      return json(res, 400, { error: "message required" });
    if (b.course && !courseAllowed(b.course)) return json(res, 400, { error: "unknown course" });
    try {
      const job = startJob(b);
      return json(res, 202, { jobId: job.id });
    } catch (e) {
      if (e instanceof BusyError) return json(res, 409, { error: "busy", job: currentJob() });
      throw e;
    }
  }

  const logParams = match("GET", "/api/jobs/:id/log", method, url);
  if (logParams) {
    const bad = guardOrigin(req);
    if (bad) return json(res, 403, { error: bad });
    const job = currentJob();
    if (!job || job.id !== logParams.id) return json(res, 404, { error: "no such job" });
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    for (const l of job.log) res.write(`data: ${JSON.stringify(l)}\n\n`);
    if (job.status !== "running") {
      res.write(`event: end\ndata: ${JSON.stringify({ exitCode: job.exitCode })}\n\n`);
      return res.end();
    }
    const offLine = onLine((l) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(l)}\n\n`);
    });
    let offEnd: () => void = () => {};
    offEnd = onEnd((j) => {
      offLine();
      offEnd();
      if (!res.writableEnded) {
        res.write(`event: end\ndata: ${JSON.stringify({ exitCode: j.exitCode })}\n\n`);
        res.end();
      }
    });
    req.on("close", () => {
      offLine();
      offEnd();
    });
    return;
  }

  if (match("POST", "/api/upload", method, url)) {
    const q = new URL(url, "http://x").searchParams;
    const course = q.get("course");
    const kind = q.get("kind") as "book" | "recording";
    if (!course || (kind !== "book" && kind !== "recording"))
      return json(res, 400, { error: "course + kind (book|recording) required" });
    const bad = guardOrigin(req);
    if (bad) return json(res, 403, { error: bad });
    if (!courseAllowed(course)) return json(res, 400, { error: "unknown course" });
    try {
      return json(res, 200, await receiveUpload(req, course, kind));
    } catch (e) {
      return json(res, 500, { error: String(e) });
    }
  }

  if (url.startsWith("/api/")) return json(res, 404, { error: "not found" });

  // static
  let file = url.split("?")[0];
  if (file === "/" || !extname(file)) file = "/index.html";
  const abs = join(WEB_DIST, file);
  if ((abs === WEB_DIST || abs.startsWith(WEB_DIST + sep)) && existsSync(abs)) {
    const body = await readFile(abs);
    res.writeHead(200, { "content-type": MIME[extname(abs)] ?? "application/octet-stream" });
    return res.end(body);
  }
  if (existsSync(join(WEB_DIST, "index.html"))) {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end(await readFile(join(WEB_DIST, "index.html")));
  }
  return json(res, 404, {
    error: "web bundle not built — run: npm run --workspace ares-dashboard-web build",
  });
}

export function createServer() {
  return httpCreate((req, res) => {
    handle(req, res).catch((e) => {
      if (!res.headersSent) json(res, 500, { error: String(e) });
      else res.end();
    });
  });
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const port = Number(process.env.ARES_BRAIN_DASHBOARD_PORT) || 4319;
  createServer().listen(port, "127.0.0.1", () =>
    console.log(`ares-brain dashboard  http://127.0.0.1:${port}`),
  );
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.on(sig, () => {
      killCurrent();
      process.exit(0);
    });
  }
}
