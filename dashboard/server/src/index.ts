import { createServer as httpCreate, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, sep } from "node:path";
import { match } from "./lib/router.js";
import { readCourses } from "./lib/courses.js";
import { receiveUpload, courseSlugOk } from "./lib/upload.js";
import { repoRoot } from "./lib/repo.js";
import {
  startJob,
  currentJob,
  lastRunMap,
  onLine,
  onEnd,
  BusyError,
  type JobKind,
} from "./lib/jobs.js";

const KINDS: JobKind[] = ["sync", "ingest", "transcribe-url", "transcribe-inbox"];
const WEB_DIST = join(repoRoot(), "dashboard", "web", "dist");
const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".ico": "image/x-icon",
};

function serverPort(): number {
  return Number(process.env.ARES_BRAIN_DASHBOARD_PORT) || 4319;
}

/**
 * Same-origin guard for state-changing routes. Returns an error string to reject
 * with, or null to allow. Blocks cross-origin POSTs and DNS-rebinding: the Host
 * header must be loopback on our port, and any Origin present must be a known
 * local / Vite dev origin.
 */
export function guardOrigin(req: IncomingMessage): string | null {
  const port = serverPort();
  const host = req.headers.host;
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return "bad host";
  const origin = req.headers.origin;
  if (
    origin &&
    ![
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`,
      "http://localhost:5173",
      "http://127.0.0.1:5173",
    ].includes(origin)
  )
    return "bad origin";
  return null;
}

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

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = req.url ?? "/";
  const method = req.method ?? "GET";

  if (match("GET", "/api/courses", method, url)) return json(res, 200, readCourses());

  if (match("GET", "/api/state", method, url))
    return json(res, 200, { job: currentJob(), lastRuns: lastRunMap() });

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
    if ((b.kind === "transcribe-url" || b.kind === "transcribe-inbox") && !b.course)
      return json(res, 400, { error: "course required" });
    if (b.kind === "transcribe-url" && !b.url) return json(res, 400, { error: "url required" });
    if (b.course && !courseSlugOk(b.course)) return json(res, 400, { error: "unknown course" });
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
}
