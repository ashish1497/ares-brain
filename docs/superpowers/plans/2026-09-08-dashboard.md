# F — Dashboard (phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** A localhost web dashboard for ares-brain — pick a course, run a sync, upload books/recordings, transcribe a YouTube link, watch the job log stream.

**Architecture:** New `dashboard/` with two npm workspaces: `dashboard/server` (Node `http`, spawns `lms_scrape.py`, one job at a time, SSE log) and `dashboard/web` (Vite + Preact + Tailwind v4, single page). The server serves the built web bundle in prod; Vite proxies `/api` in dev. Two new Python entry points feed it.

**Tech Stack:** Node 20 + TypeScript, Vite 6, Preact 10, Tailwind v4, `busboy`; Python 3.12 (`uv`), `yt-dlp`, `faster-whisper`.

**Spec:** `docs/superpowers/specs/2026-09-08-dashboard-design.md`

## Global Constraints

- New `dashboard/` workspaces; root `package.json` `workspaces` becomes `["mcp", "dashboard/*"]`.
- Server binds `127.0.0.1` ONLY. No auth. Port `ARES_BRAIN_DASHBOARD_PORT`, default `4319`.
- **No LLM call anywhere in phase 1.** No `claude -p`.
- Server never reads/serves `.env`, `client_secret.json`, `token.json`.
- Server does deterministic work only by spawning `lms_scrape.py` with `ARES_BRAIN_HOME` set — it never imports Python or re-implements scraper logic.
- One job at a time: a second start while `status === "running"` → HTTP 409.
- `transcribe_url` never raises — returns `{"ok": bool, ...}`.
- Upload targets are `courses/<slug>/inbox/books/` and `courses/<slug>/inbox/recordings/` (the paths `ingest` and `transcribe` already read).
- `dashboard/**/dist/` gitignored + prettier-ignored. Frontend uses Tailwind `@theme` tokens, works in light AND dark mode.
- Branch `f-dashboard` off `main`. TDD. Frequent commits.

---

## File Structure

```
dashboard/
  server/
    package.json            name "ares-dashboard-server", type module
    tsconfig.json
    src/
      index.ts              http server, route table, static serving
      lib/
        repo.ts             repoRoot(), venvPython()
        python.ts           runPython(args, onLine) — spawn + line-buffer
        jobs.ts             one-job-at-a-time runner, EventEmitter, ring log
        courses.ts          readCourses() from courses/_index.json
        upload.ts           busboy multipart -> inbox files
        router.ts           tiny method+path matcher with :params
    test/
      jobs.test.ts
      router.test.ts
      upload.test.ts
      routes.test.ts
  web/
    package.json            name "ares-dashboard-web", type module
    vite.config.ts
    tsconfig.json
    index.html
    src/
      main.tsx
      app.tsx
      api.ts
      style.css             @import "tailwindcss" + @theme
      components/
        Card.tsx
        CoursePicker.tsx
        SyncCard.tsx
        UploadCard.tsx
        YouTubeCard.tsx
        JobLog.tsx
    test/
      CoursePicker.test.tsx
      JobLog.test.tsx
      SyncCard.test.tsx
      setup.ts
scraper/
  transcribe.py             + transcribe_url(), + inbox_only param
  lms_scrape.py             + transcribe-url subcommand, + transcribe --inbox
  tests/
    test_transcribe_url.py
    test_transcribe_inbox.py
commands/
  ares-brain-dashboard.md
.github/workflows/ci.yml    + dashboard job
```

---

## Task 1: Python — `transcribe-url` + `transcribe --inbox`

**Files:**

- Modify: `scraper/transcribe.py`
- Modify: `scraper/lms_scrape.py` (subparser block near line 128; dispatch near line 183)
- Create: `scraper/tests/test_transcribe_url.py`
- Create: `scraper/tests/test_transcribe_inbox.py`
- Modify: `scraper/tests/test_cli.py`

**Interfaces:**

- Consumes: `transcribe._pull_audio(url, dest_dir) -> Path|None`, `transcribe._whisper(audio) -> list[(float,str)]`, `transcribe._fmt_ts`, `transcribe._yaml_scalar`, `transcribe.step_transcribe`, `paths.course_dir`, `paths.ensure`, `scrape_steps.global_file`, `scrape_steps._read_or_none`.
- Produces:
  - `transcribe.transcribe_url(slug: str, url: str, title: str | None = None) -> dict` → `{"ok": True, "path": "transcripts/url-<h>.md", "url": url, "title": <resolved>}` or `{"ok": False, "error": <str>}`.
  - `transcribe.step_transcribe(index, course=None, inbox_only=False) -> dict` (new kwarg; default preserves current behaviour).
  - CLI `transcribe-url --course <slug> --url <url> [--title <t>] [--json]`.
  - CLI `transcribe --inbox` (with `--course`).

- [ ] **Step 1: Write the failing tests — `scraper/tests/test_transcribe_url.py`**

```python
import json
from pathlib import Path
import pytest
import transcribe


@pytest.fixture
def idx(home):
    (home / "courses").mkdir(parents=True, exist_ok=True)
    (home / "courses" / "_index.json").write_text(
        json.dumps([{"id": "x", "name": "AI Course", "slug": "ai-course"}]))
    import importlib, paths
    importlib.reload(paths); importlib.reload(transcribe)
    return home


def test_transcribe_url_writes_transcript(idx, monkeypatch):
    monkeypatch.setattr(transcribe, "_pull_audio",
                        lambda url, d: Path(d) / "fake.m4a")
    monkeypatch.setattr(transcribe, "_whisper",
                        lambda a: [(0.0, "hello"), (5.0, "world")])
    r = transcribe.transcribe_url("ai-course", "https://youtu.be/abc", title="Lecture 1")
    assert r["ok"] is True
    p = idx / "courses" / "ai-course" / "transcripts" / r["path"].split("/")[-1]
    body = p.read_text()
    assert "type: transcript" in body
    assert '"Lecture 1"' in body
    assert "url:https://youtu.be/abc" in body or "url:https" in body
    assert "[00:00:00] hello" in body and "[00:00:05] world" in body


def test_transcribe_url_bad_course(idx):
    r = transcribe.transcribe_url("no-such", "https://youtu.be/abc")
    assert r["ok"] is False and "course" in r["error"].lower()


def test_transcribe_url_audio_pull_fails(idx, monkeypatch):
    monkeypatch.setattr(transcribe, "_pull_audio", lambda url, d: None)
    r = transcribe.transcribe_url("ai-course", "https://youtu.be/x")
    assert r["ok"] is False and "audio" in r["error"].lower()


def test_transcribe_url_whisper_raises(idx, monkeypatch):
    monkeypatch.setattr(transcribe, "_pull_audio", lambda url, d: Path(d) / "f.m4a")
    def boom(a): raise RuntimeError("model exploded")
    monkeypatch.setattr(transcribe, "_whisper", boom)
    r = transcribe.transcribe_url("ai-course", "https://youtu.be/x")
    assert r["ok"] is False  # never raises
```

`scraper/tests/test_transcribe_inbox.py`:

```python
import json
from pathlib import Path
import pytest
import transcribe


@pytest.fixture
def course(home, monkeypatch):
    root = home / "courses" / "ai-course"
    (root / "inbox" / "recordings").mkdir(parents=True)
    (root / "raw").mkdir(parents=True)
    (root / "raw" / "recordings.json").write_text(json.dumps(
        [{"id": "yt1", "title": "Class 1", "videoUrl": "https://youtu.be/yt1"}]))
    (home / "courses" / "_index.json").write_text(json.dumps(
        [{"id": "x", "name": "AI Course", "slug": "ai-course"}]))
    (root / "inbox" / "recordings" / "myclip.m4a").write_bytes(b"fake")
    import importlib, paths
    importlib.reload(paths); importlib.reload(transcribe)
    return home


def test_inbox_only_skips_youtube(course, monkeypatch):
    calls = []
    monkeypatch.setattr(transcribe, "_pull_audio",
                        lambda url, d: calls.append(url) or None)
    monkeypatch.setattr(transcribe, "_whisper", lambda a: [(0.0, "hi")])
    idx = json.loads((course / "courses" / "_index.json").read_text())
    r = transcribe.step_transcribe(idx, "ai-course", inbox_only=True)
    assert calls == []                       # never touched the YouTube rec
    assert "inbox-myclip" in r["transcribed"]
    assert (course / "courses" / "ai-course" / "transcripts" / "inbox-myclip.md").exists()
```

Add to `scraper/tests/test_cli.py`:

```python
def test_cli_transcribe_url_dispatch(home, monkeypatch):
    import json, importlib, paths, transcribe
    (home / "courses").mkdir(parents=True, exist_ok=True)
    (home / "courses" / "_index.json").write_text(json.dumps(
        [{"id": "x", "name": "C", "slug": "c1"}]))
    importlib.reload(paths); importlib.reload(transcribe)
    monkeypatch.setattr(transcribe, "transcribe_url",
                        lambda *a, **k: {"ok": True, "path": "transcripts/url-x.md"})
    import lms_scrape
    r = lms_scrape.run(["transcribe-url", "--course", "c1",
                        "--url", "https://youtu.be/x", "--json"])
    assert r["ok"] is True
```

- [ ] **Step 2: Run, verify fail**

`cd scraper && uv run pytest tests/test_transcribe_url.py tests/test_transcribe_inbox.py -x -q`
Expected: FAIL — `transcribe_url` undefined, `inbox_only` unexpected kwarg.

- [ ] **Step 3: Implement in `scraper/transcribe.py`**

Add `import hashlib` and `from datetime import date` to the imports. After `_write_transcript` add:

```python
def _write_url_transcript(dest, url, title, segs):
    body = "\n".join(f"[{_fmt_ts(s)}] {t}" for s, t in segs)
    fm = [
        "---",
        "type: transcript",
        f"source: {_yaml_scalar('url:' + url)}",
        f"title: {_yaml_scalar(title)}",
        f"recordedOn: {_yaml_scalar(date.today().isoformat())}",
        "---", "",
    ]
    ensure(dest.parent)
    dest.write_text("\n".join(fm) + body + "\n")


def transcribe_url(slug: str, url: str, title: str | None = None) -> dict:
    try:
        idx = _read_or_none(global_file("_index.json")) or []
        course = next((c for c in idx if c.get("slug") == slug), None)
        if course is None:
            return {"ok": False, "error": f"unknown course slug: {slug}"}
        resolved = title or url
        dest = course_dir(slug) / "transcripts" / f"url-{hashlib.sha1(url.encode()).hexdigest()[:10]}.md"
        if dest.exists():
            return {"ok": True, "path": f"transcripts/{dest.name}", "url": url,
                    "title": resolved, "skipped": True}
        with tempfile.TemporaryDirectory() as tmp:
            audio = _pull_audio(url, Path(tmp))
            if audio is None:
                return {"ok": False, "error": "could not pull audio from the url"}
            try:
                segs = _whisper(audio)
            except Exception as exc:  # noqa: BLE001
                return {"ok": False, "error": f"transcription failed: {exc}"}
        _write_url_transcript(dest, url, resolved, segs)
        return {"ok": True, "path": f"transcripts/{dest.name}", "url": url, "title": resolved}
    except Exception as exc:  # noqa: BLE001 - never raise
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
```

Add `from scrape_steps import global_file` to the existing `from scrape_steps import ...` line (currently `_write_json, _read_or_none`).

Change `step_transcribe` signature + body:

```python
def step_transcribe(index: list[dict], course: str | None = None,
                    inbox_only: bool = False) -> dict:
    scope = [c for c in index if course is None or c["slug"] == course]
    transcribed, skipped, failed = [], [], []
    for c in scope:
        try:
            _transcribe_course(c, transcribed, skipped, failed, inbox_only=inbox_only)
        except Exception as exc:  # noqa: BLE001
            failed.append({"id": c.get("slug", "?"), "status": "needs-manual",
                           "error": f"{type(exc).__name__}: {exc}"})
    return {"transcribed": transcribed, "skipped": skipped, "failed": failed}
```

In `_transcribe_course`, add the param and guard the YouTube loop:

```python
def _transcribe_course(c, transcribed, skipped, failed, inbox_only=False):
    tdir = course_dir(c["slug"]) / "transcripts"
    recs = []
    if not inbox_only:
        try:
            recs = _read_or_none(raw_dir(c["slug"]) / "recordings.json") or []
        except Exception as exc:  # noqa: BLE001
            failed.append({"id": c.get("slug", "?"), "status": "needs-manual",
                           "error": f"recordings.json unreadable: {exc}"})
        if not isinstance(recs, list):
            recs = []
    # ... rest unchanged (the `for rec in recs` loop is now empty when inbox_only) ...
```

- [ ] **Step 4: Add CLI in `scraper/lms_scrape.py`**

Near the `transcribe` subparser (line ~128):

```python
    t = sub.add_parser("transcribe")
    t.add_argument("--course")
    t.add_argument("--inbox", action="store_true")
    t.add_argument("--json", action="store_true")
    tu = sub.add_parser("transcribe-url")
    tu.add_argument("--course", required=True)
    tu.add_argument("--url", required=True)
    tu.add_argument("--title")
    tu.add_argument("--json", action="store_true")
```

In the dispatch (near line 183):

```python
    if args.cmd == "transcribe":
        import transcribe as _t
        index = json.loads(scrape_steps.global_file("_index.json").read_text())
        result = _t.step_transcribe(index, args.course, inbox_only=args.inbox)
        print(json.dumps(result) if args.json else json.dumps(result, indent=1))
        return result
    if args.cmd == "transcribe-url":
        import transcribe as _t
        result = _t.transcribe_url(args.course, args.url, args.title)
        print(json.dumps(result) if args.json else json.dumps(result, indent=1))
        return result
```

(If the existing `transcribe` block reads the index differently, keep its style; just thread `inbox_only=args.inbox`.)

- [ ] **Step 5: Run tests, verify pass**

`cd scraper && uv run pytest -q` — expect prior count + 8 new, all green.

- [ ] **Step 6: Commit**

```bash
git add scraper/
git commit -m "feat(scraper): transcribe-url + transcribe --inbox

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Dashboard server

**Files:** everything under `dashboard/server/` (see File Structure); modify root `package.json` `workspaces`.

**Interfaces:**

- Consumes: `lms_scrape.py` subcommands (`all`, `ingest`, `transcribe`, `transcribe-url`); `courses/_index.json`.
- Produces (for Task 3, over HTTP): the routes in spec §3. Job JSON shape:
  `{id, kind, course, status:"running"|"done"|"failed", startedAt, finishedAt?, exitCode?, log:string[]}`.

- [ ] **Step 1: Scaffold the workspace**

`dashboard/server/package.json`:

```json
{
  "name": "ares-dashboard-server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx watch src/index.ts",
    "test": "vitest run"
  },
  "dependencies": { "busboy": "^1.6.0" },
  "devDependencies": {
    "@types/busboy": "^1.5.4",
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

`dashboard/server/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

Root `package.json`: change `"workspaces": ["mcp"]` → `"workspaces": ["mcp", "dashboard/*"]`.

Run: `npm install` (root). Approve esbuild scripts if prompted (`npm install-scripts approve esbuild`).

- [ ] **Step 2: `src/lib/repo.ts` + test-first for `router.ts`**

`dashboard/server/src/lib/repo.ts`:

```ts
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function repoRoot(): string {
  if (process.env.ARES_BRAIN_HOME) return resolve(process.env.ARES_BRAIN_HOME);
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "scraper", "lms_scrape.py"))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}

export function venvPython(): string {
  return join(repoRoot(), "scraper", ".venv", "bin", "python");
}
```

`dashboard/server/test/router.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { match } from "../src/lib/router.js";

describe("router match", () => {
  it("matches a literal path", () => {
    expect(match("GET", "/api/courses", "GET", "/api/courses")).toEqual({});
  });
  it("captures :params", () => {
    expect(match("GET", "/api/jobs/:id/log", "GET", "/api/jobs/abc123/log")).toEqual({
      id: "abc123",
    });
  });
  it("rejects a method mismatch", () => {
    expect(match("POST", "/api/jobs", "GET", "/api/jobs")).toBeNull();
  });
  it("rejects a length mismatch", () => {
    expect(match("GET", "/api/jobs/:id", "GET", "/api/jobs/a/b")).toBeNull();
  });
});
```

`dashboard/server/src/lib/router.ts`:

```ts
export function match(
  method: string,
  pattern: string,
  reqMethod: string,
  reqPath: string,
): Record<string, string> | null {
  if (method !== reqMethod) return null;
  const p = pattern.split("/").filter(Boolean);
  const q = reqPath.split("?")[0].split("/").filter(Boolean);
  if (p.length !== q.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(":")) params[p[i].slice(1)] = decodeURIComponent(q[i]);
    else if (p[i] !== q[i]) return null;
  }
  return params;
}
```

Run: `npm run --workspace ares-dashboard-server test` — router tests pass.

- [ ] **Step 3: `src/lib/python.ts`**

```ts
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, venvPython } from "./repo.js";

export function runPython(
  args: string[],
  onLine: (line: string) => void,
): { done: Promise<{ code: number }>; kill: () => void } {
  const py = venvPython();
  if (!existsSync(py)) {
    onLine(
      "python sidecar missing — run: cd scraper && uv venv --python 3.12 .venv && uv pip install -r requirements.txt",
    );
    return { done: Promise.resolve({ code: 127 }), kill: () => {} };
  }
  const child = spawn(py, ["lms_scrape.py", ...args], {
    cwd: join(repoRoot(), "scraper"),
    env: { ...process.env, ARES_BRAIN_HOME: repoRoot() },
  });
  let buf = "";
  const pump = (chunk: Buffer) => {
    buf += chunk.toString("utf8");
    const parts = buf.split("\n");
    buf = parts.pop() ?? "";
    for (const l of parts) onLine(l);
  };
  child.stdout.on("data", pump);
  child.stderr.on("data", pump);
  const done = new Promise<{ code: number }>((res) => {
    child.on("error", (e) => {
      onLine(`spawn error: ${e}`);
      res({ code: 1 });
    });
    child.on("close", (code) => {
      if (buf) onLine(buf);
      res({ code: code ?? 0 });
    });
  });
  return { done, kill: () => child.kill("SIGTERM") };
}
```

No test (thin spawn wrapper; covered via `jobs.test.ts` with a fake).

- [ ] **Step 4: test-first `src/lib/jobs.ts`**

`dashboard/server/test/jobs.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/lib/python.js", () => ({
  runPython: vi.fn(),
}));
import { runPython } from "../src/lib/python.js";
import { startJob, currentJob, onLine, BusyError } from "../src/lib/jobs.js";

function fakeRun() {
  let emit: (l: string) => void = () => {};
  let finish: (c: { code: number }) => void = () => {};
  (runPython as any).mockImplementation((_a: string[], cb: (l: string) => void) => {
    emit = cb;
    return { done: new Promise((r) => (finish = r)), kill: () => {} };
  });
  return { emit: (l: string) => emit(l), finish: (code: number) => finish({ code }) };
}

beforeEach(() => vi.clearAllMocks());

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
```

`dashboard/server/src/lib/jobs.ts`:

```ts
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { runPython } from "./python.js";

export class BusyError extends Error {}

export type JobKind = "sync" | "ingest" | "transcribe-url" | "transcribe-inbox";

export interface Job {
  id: string;
  kind: JobKind;
  course?: string;
  status: "running" | "done" | "failed";
  startedAt: string;
  finishedAt?: string;
  exitCode?: number;
  log: string[];
}

export interface StartOpts {
  kind: JobKind;
  course?: string;
  url?: string;
  title?: string;
}

const LOG_CAP = 2000;
const bus = new EventEmitter();
let current: Job | null = null;
let kill: () => void = () => {};
const lastRuns: Record<string, { finishedAt: string; exitCode: number }> = {};

function argv(o: StartOpts): string[] {
  switch (o.kind) {
    case "sync":
      return ["all"];
    case "ingest":
      return o.course ? ["ingest", "--course", o.course] : ["ingest"];
    case "transcribe-inbox":
      return ["transcribe", "--course", o.course!, "--inbox", "--json"];
    case "transcribe-url":
      return [
        "transcribe-url",
        "--course",
        o.course!,
        "--url",
        o.url!,
        ...(o.title ? ["--title", o.title] : []),
        "--json",
      ];
  }
}

export function currentJob(): Job | null {
  return current;
}
export function lastRunMap() {
  return lastRuns;
}
export function onLine(fn: (line: string) => void) {
  bus.on("line", fn);
  return () => bus.off("line", fn);
}
export function onEnd(fn: (j: Job) => void) {
  bus.on("end", fn);
  return () => bus.off("end", fn);
}

export function startJob(o: StartOpts): Job {
  if (current?.status === "running") throw new BusyError("a job is already running");
  const job: Job = {
    id: randomUUID(),
    kind: o.kind,
    course: o.course,
    status: "running",
    startedAt: new Date().toISOString(),
    log: [],
  };
  current = job;
  const push = (l: string) => {
    job.log.push(l);
    if (job.log.length > LOG_CAP) job.log.splice(0, job.log.length - LOG_CAP);
    bus.emit("line", l);
  };
  const handle = runPython(argv(o), push);
  kill = handle.kill;
  handle.done.then(({ code }) => {
    job.status = code === 0 ? "done" : "failed";
    job.exitCode = code;
    job.finishedAt = new Date().toISOString();
    lastRuns[job.kind] = { finishedAt: job.finishedAt, exitCode: code };
    bus.emit("end", job);
  });
  return job;
}

export function killCurrent() {
  if (current?.status === "running") kill();
}
```

Run: `npm run --workspace ares-dashboard-server test` — jobs tests pass.

- [ ] **Step 5: `src/lib/courses.ts` + `src/lib/upload.ts`**

`courses.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./repo.js";

export function readCourses(): { slug: string; name: string }[] {
  try {
    const raw = JSON.parse(readFileSync(join(repoRoot(), "courses", "_index.json"), "utf8"));
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((c) => c && typeof c.slug === "string")
      .map((c) => ({ slug: c.slug, name: c.name ?? c.slug }));
  } catch {
    return [];
  }
}
```

`dashboard/server/test/upload.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { extOk, safeName } from "../src/lib/upload.js";

describe("upload helpers", () => {
  it("book accepts pdf/docx only", () => {
    expect(extOk("book", "a.pdf")).toBe(true);
    expect(extOk("book", "a.PDF")).toBe(true);
    expect(extOk("book", "a.mp3")).toBe(false);
  });
  it("recording accepts audio/video", () => {
    expect(extOk("recording", "c.m4a")).toBe(true);
    expect(extOk("recording", "c.txt")).toBe(false);
  });
  it("safeName strips path + weird chars", () => {
    expect(safeName("../../etc/pa ss.pdf")).toBe("pa_ss.pdf");
    expect(safeName("nice-file.pdf")).toBe("nice-file.pdf");
  });
});
```

`src/lib/upload.ts`:

```ts
import busboy from "busboy";
import { createWriteStream, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { IncomingMessage } from "node:http";
import { repoRoot } from "./repo.js";

const OK: Record<string, RegExp> = {
  book: /\.(pdf|docx)$/i,
  recording: /\.(m4a|mp3|wav|mp4|webm)$/i,
};

export function extOk(kind: "book" | "recording", name: string) {
  return OK[kind]?.test(name) ?? false;
}
export function safeName(name: string) {
  return basename(name)
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+/, "");
}

export function receiveUpload(
  req: IncomingMessage,
  course: string,
  kind: "book" | "recording",
): Promise<{ written: string[]; rejected: { name: string; reason: string }[] }> {
  return new Promise((resolve, reject) => {
    const dir = join(
      repoRoot(),
      "courses",
      course,
      "inbox",
      kind === "book" ? "books" : "recordings",
    );
    mkdirSync(dir, { recursive: true });
    const written: string[] = [];
    const rejected: { name: string; reason: string }[] = [];
    const bb = busboy({ headers: req.headers, limits: { fileSize: 512 * 1024 * 1024 } });
    const pending: Promise<void>[] = [];
    bb.on("file", (_field, stream, info) => {
      const name = safeName(info.filename || "file");
      if (!extOk(kind, name)) {
        rejected.push({ name, reason: "unsupported file type" });
        stream.resume();
        return;
      }
      pending.push(
        new Promise((res, rej) => {
          const ws = createWriteStream(join(dir, name));
          stream.pipe(ws);
          ws.on("finish", () => {
            written.push(name);
            res();
          });
          ws.on("error", rej);
        }),
      );
    });
    bb.on("close", () => Promise.all(pending).then(() => resolve({ written, rejected }), reject));
    bb.on("error", reject);
    req.pipe(bb);
  });
}
```

Run: `npm run --workspace ares-dashboard-server test` — upload helper tests pass.

- [ ] **Step 6: test-first `src/index.ts` (routes)**

`dashboard/server/test/routes.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("../src/lib/jobs.js", async (orig) => {
  const actual = await orig<typeof import("../src/lib/jobs.js")>();
  return { ...actual };
});

import { createServer } from "../src/index.js";
import type { Server } from "node:http";

let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const a = server.address() as any;
  base = `http://127.0.0.1:${a.port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

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
});
```

`dashboard/server/src/index.ts`:

```ts
import { createServer as httpCreate, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import { match } from "./lib/router.js";
import { readCourses } from "./lib/courses.js";
import { receiveUpload } from "./lib/upload.js";
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
    const offLine = onLine((l) => res.write(`data: ${JSON.stringify(l)}\n\n`));
    const offEnd = onEnd((j) => {
      res.write(`event: end\ndata: ${JSON.stringify({ exitCode: j.exitCode })}\n\n`);
      res.end();
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
  if (abs.startsWith(WEB_DIST) && existsSync(abs)) {
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
```

- [ ] **Step 7: build + test + commit**

```
npm run --workspace ares-dashboard-server build
npm run --workspace ares-dashboard-server test
npx prettier --write "dashboard/server/**/*.ts"
npx eslint dashboard/server   # after Task 4 wires the glob; skip if it errors here
```

```bash
git add dashboard/server package.json package-lock.json
git commit -m "feat(dashboard): server — job runner, SSE log, routes, upload

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Dashboard web

**Files:** everything under `dashboard/web/`.

**Interfaces:**

- Consumes: the server routes from Task 2.
- Produces: a built SPA in `dashboard/web/dist/` that Task 2's server serves.

- [ ] **Step 1: Scaffold**

`dashboard/web/package.json`:

```json
{
  "name": "ares-dashboard-web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": { "preact": "^10.24.0" },
  "devDependencies": {
    "@preact/preset-vite": "^2.9.0",
    "@tailwindcss/vite": "^4.0.0",
    "@testing-library/preact": "^3.2.4",
    "jsdom": "^25.0.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.6.0",
    "vite": "^6.0.0",
    "vitest": "^2.1.0"
  }
}
```

`dashboard/web/vite.config.ts`:

```ts
import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import tailwind from "@tailwindcss/vite";

export default defineConfig({
  plugins: [preact(), tailwind()],
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:4319" } },
  test: { environment: "jsdom", setupFiles: ["./test/setup.ts"] },
});
```

`dashboard/web/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
    "strict": true,
    "skipLibCheck": true,
    "types": ["vitest/globals"]
  },
  "include": ["src", "test"]
}
```

`dashboard/web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Ares Brain</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`dashboard/web/src/style.css`:

```css
@import "tailwindcss";

@theme {
  --color-surface-0: #faf9f7;
  --color-surface-1: #f3f1ec;
  --color-surface-2: #ffffff;
  --color-ink: #1f1e1c;
  --color-ink-soft: #57544e;
  --color-line: #e3e0d8;
  --color-accent: #3a6ea5;
  --radius-card: 12px;
}

@media (prefers-color-scheme: dark) {
  @theme {
    --color-surface-0: #17181a;
    --color-surface-1: #1e2023;
    --color-surface-2: #24262a;
    --color-ink: #e9e8e4;
    --color-ink-soft: #a2a09a;
    --color-line: #33363b;
    --color-accent: #6fa8dc;
  }
}

html,
body,
#app {
  height: 100%;
}
body {
  background: var(--color-surface-0);
  color: var(--color-ink);
}
```

`dashboard/web/src/main.tsx`:

```tsx
import { render } from "preact";
import { App } from "./app";
import "./style.css";

render(<App />, document.getElementById("app")!);
```

`dashboard/web/test/setup.ts`:

```ts
import "@testing-library/preact";
```

- [ ] **Step 2: `src/api.ts`**

```ts
export interface Course {
  slug: string;
  name: string;
}
export interface Job {
  id: string;
  kind: string;
  course?: string;
  status: "running" | "done" | "failed";
  startedAt: string;
  finishedAt?: string;
  exitCode?: number;
  log: string[];
}
export interface State {
  job: Job | null;
  lastRuns: Record<string, { finishedAt: string; exitCode: number }>;
}

const j = (r: Response) => r.json();

export const getCourses = (): Promise<Course[]> => fetch("/api/courses").then(j);
export const getState = (): Promise<State> => fetch("/api/state").then(j);

export async function startJob(body: {
  kind: string;
  course?: string;
  url?: string;
  title?: string;
}): Promise<{ jobId?: string; error?: string }> {
  const r = await fetch("/api/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

export async function upload(
  course: string,
  kind: "book" | "recording",
  files: FileList,
): Promise<{ written: string[]; rejected: { name: string; reason: string }[] }> {
  const fd = new FormData();
  for (const f of Array.from(files)) fd.append("files", f);
  const r = await fetch(`/api/upload?course=${encodeURIComponent(course)}&kind=${kind}`, {
    method: "POST",
    body: fd,
  });
  return r.json();
}

export function streamLog(
  jobId: string,
  onLine: (l: string) => void,
  onEnd: (exitCode: number) => void,
): () => void {
  const es = new EventSource(`/api/jobs/${jobId}/log`);
  es.onmessage = (e) => onLine(JSON.parse(e.data));
  es.addEventListener("end", (e) => {
    onEnd(JSON.parse((e as MessageEvent).data).exitCode);
    es.close();
  });
  es.onerror = () => es.close();
  return () => es.close();
}
```

- [ ] **Step 3: components**

`src/components/Card.tsx`:

```tsx
import type { ComponentChildren } from "preact";

export function Card({
  icon,
  title,
  children,
}: {
  icon: string;
  title: string;
  children: ComponentChildren;
}) {
  return (
    <div class="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface-2)] p-5">
      <div class="mb-1 flex items-center gap-2 text-sm font-medium">
        <i class={`ti ti-${icon}`} aria-hidden="true" /> {title}
      </div>
      {children}
    </div>
  );
}
```

`src/components/CoursePicker.tsx`:

```tsx
import type { Course } from "../api";

export function CoursePicker({
  courses,
  value,
  onChange,
}: {
  courses: Course[];
  value: string;
  onChange: (slug: string) => void;
}) {
  return (
    <select
      class="h-9 rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 text-sm"
      value={value}
      onChange={(e) => onChange((e.target as HTMLSelectElement).value)}
    >
      {courses.map((c) => (
        <option value={c.slug}>{c.name}</option>
      ))}
    </select>
  );
}
```

`src/components/SyncCard.tsx`:

```tsx
import { Card } from "./Card";
import type { Job, State } from "../api";

export function SyncCard({
  job,
  last,
  busy,
  onRun,
}: {
  job: Job | null;
  last?: State["lastRuns"][string];
  busy: boolean;
  onRun: () => void;
}) {
  const running = busy && job?.kind === "sync";
  return (
    <Card icon="refresh" title="Sync from Nexus">
      <p class="mb-3 text-[13px] leading-relaxed text-[var(--color-ink-soft)]">
        Scrape, ingest, and re-index every course.
        {last
          ? ` Last run ${new Date(last.finishedAt).toLocaleString()}${last.exitCode ? " (failed)" : ""}.`
          : ""}
      </p>
      <button
        class="h-9 w-full rounded-md border border-[var(--color-line)] text-sm disabled:opacity-50"
        disabled={busy}
        onClick={onRun}
      >
        {running ? "Sync running…" : busy ? "Job running…" : "Run sync"}
      </button>
    </Card>
  );
}
```

`src/components/UploadCard.tsx`:

```tsx
import { useRef, useState } from "preact/hooks";
import { Card } from "./Card";
import { upload } from "../api";

export function UploadCard({
  kind,
  course,
  busy,
  onQueued,
}: {
  kind: "book" | "recording";
  course: string;
  busy: boolean;
  onQueued: (kind: "ingest" | "transcribe-inbox") => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState("");
  const title = kind === "book" ? "Add books" : "Add recordings";
  const hint = kind === "book" ? "PDF or DOCX" : "Audio — transcribes after upload (~19 min)";

  async function pick(files: FileList | null) {
    if (!files?.length || !course) return;
    setMsg("uploading…");
    const r = await upload(course, kind, files);
    setMsg(
      [
        r.written.length ? `${r.written.length} uploaded` : "",
        r.rejected.length ? `${r.rejected.length} rejected` : "",
      ]
        .filter(Boolean)
        .join(" · ") || "nothing uploaded",
    );
    if (r.written.length) onQueued(kind === "book" ? "ingest" : "transcribe-inbox");
  }

  return (
    <Card icon={kind === "book" ? "book" : "microphone"} title={title}>
      <p class="mb-3 text-[13px] text-[var(--color-ink-soft)]">{hint}</p>
      <button
        class="h-9 w-full rounded-md border border-dashed border-[var(--color-line)] text-[13px] text-[var(--color-ink-soft)] disabled:opacity-50"
        disabled={busy || !course}
        onClick={() => input.current?.click()}
      >
        Choose files
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept={kind === "book" ? ".pdf,.docx" : ".m4a,.mp3,.wav,.mp4,.webm"}
        onChange={(e) => pick((e.target as HTMLInputElement).files)}
      />
      {msg && <p class="mt-2 text-[12px] text-[var(--color-ink-soft)]">{msg}</p>}
    </Card>
  );
}
```

`src/components/YouTubeCard.tsx`:

```tsx
import { useState } from "preact/hooks";
import { Card } from "./Card";

export function YouTubeCard({
  course,
  busy,
  onRun,
}: {
  course: string;
  busy: boolean;
  onRun: (url: string, title: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [err, setErr] = useState("");
  return (
    <Card icon="brand-youtube" title="YouTube transcribe">
      <p class="mb-2 text-[13px] text-[var(--color-ink-soft)]">Paste a lecture link.</p>
      <input
        class="mb-2 h-9 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 text-sm"
        placeholder="https://youtu.be/…"
        value={url}
        onInput={(e) => {
          setUrl((e.target as HTMLInputElement).value);
          setErr("");
        }}
      />
      <input
        class="mb-2 h-9 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 text-sm"
        placeholder="title (optional)"
        value={title}
        onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
      />
      {err && <p class="mb-2 text-[12px] text-red-600">{err}</p>}
      <button
        class="h-9 w-full rounded-md border border-[var(--color-line)] text-sm disabled:opacity-50"
        disabled={busy || !course}
        onClick={() => {
          if (!/^https?:\/\//.test(url.trim())) {
            setErr("Enter a valid URL first");
            return;
          }
          onRun(url.trim(), title.trim());
        }}
      >
        Transcribe
      </button>
    </Card>
  );
}
```

`src/components/JobLog.tsx`:

```tsx
import { useEffect, useRef } from "preact/hooks";
import type { Job } from "../api";

export function JobLog({ job, lines }: { job: Job | null; lines: string[] }) {
  const pre = useRef<HTMLPreElement>(null);
  useEffect(() => {
    pre.current?.scrollTo(0, pre.current.scrollHeight);
  }, [lines]);
  const dot = !job
    ? "bg-[var(--color-ink-soft)]"
    : job.status === "running"
      ? "bg-green-500"
      : job.status === "failed"
        ? "bg-red-500"
        : "bg-[var(--color-ink-soft)]";
  return (
    <div class="mt-4 rounded-[var(--radius-card)] bg-[var(--color-surface-1)] p-3">
      <div class="mb-2 flex items-center gap-2 text-[13px]">
        <span class={`inline-block h-2 w-2 rounded-full ${dot}`} />
        {job ? `${job.status} · ${job.kind}` : "No job running"}
      </div>
      <pre
        ref={pre}
        class="m-0 max-h-40 overflow-auto rounded-md bg-[var(--color-surface-0)] p-2 font-mono text-[12px] leading-snug text-[var(--color-ink-soft)]"
      >
        {lines.join("\n") || (job ? "" : "—")}
      </pre>
    </div>
  );
}
```

- [ ] **Step 4: `src/app.tsx`**

```tsx
import { useEffect, useRef, useState } from "preact/hooks";
import * as api from "./api";
import type { Course, Job, State } from "./api";
import { CoursePicker } from "./components/CoursePicker";
import { SyncCard } from "./components/SyncCard";
import { UploadCard } from "./components/UploadCard";
import { YouTubeCard } from "./components/YouTubeCard";
import { JobLog } from "./components/JobLog";

export function App() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [course, setCourse] = useState("");
  const [state, setState] = useState<State>({ job: null, lastRuns: {} });
  const [lines, setLines] = useState<string[]>([]);
  const stopRef = useRef<() => void>();

  const job: Job | null = state.job;
  const busy = job?.status === "running";

  useEffect(() => {
    api.getCourses().then((c) => {
      setCourses(c);
      if (c[0]) setCourse(c[0].slug);
    });
    api.getState().then(setState);
  }, []);

  useEffect(() => {
    if (busy) return;
    const t = setInterval(() => api.getState().then(setState), 3000);
    return () => clearInterval(t);
  }, [busy]);

  function follow(jobId: string) {
    setLines([]);
    stopRef.current?.();
    stopRef.current = api.streamLog(
      jobId,
      (l) => setLines((prev) => [...prev, l]),
      () => api.getState().then(setState),
    );
  }

  async function run(body: Parameters<typeof api.startJob>[0]) {
    const r = await api.startJob(body);
    if (r.jobId) {
      const s = await api.getState();
      setState(s);
      follow(r.jobId);
    } else if (r.error) {
      setLines((p) => [...p, `! ${r.error}`]);
    }
  }

  return (
    <div class="mx-auto max-w-3xl p-6">
      <header class="mb-4 flex items-center justify-between border-b border-[var(--color-line)] pb-3">
        <div class="flex items-center gap-2 text-base font-medium">
          <i class="ti ti-brain" aria-hidden="true" /> Ares Brain
        </div>
        <div class="flex items-center gap-2">
          <span class="text-[13px] text-[var(--color-ink-soft)]">Course</span>
          <CoursePicker courses={courses} value={course} onChange={setCourse} />
        </div>
      </header>

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SyncCard
          job={job}
          last={state.lastRuns.sync}
          busy={!!busy}
          onRun={() => run({ kind: "sync" })}
        />
        <UploadCard
          kind="book"
          course={course}
          busy={!!busy}
          onQueued={(k) => run({ kind: k, course })}
        />
        <UploadCard
          kind="recording"
          course={course}
          busy={!!busy}
          onQueued={(k) => run({ kind: k, course })}
        />
        <YouTubeCard
          course={course}
          busy={!!busy}
          onRun={(url, title) => run({ kind: "transcribe-url", course, url, title })}
        />
      </div>

      <JobLog job={job} lines={lines} />

      <p class="mt-3 flex items-center gap-2 text-[12px] text-[var(--color-ink-soft)]">
        <i class="ti ti-message-circle" aria-hidden="true" /> Chat — phase 2
      </p>
    </div>
  );
}
```

- [ ] **Step 5: component tests**

`dashboard/web/test/CoursePicker.test.tsx`:

```tsx
import { render, screen } from "@testing-library/preact";
import { CoursePicker } from "../src/components/CoursePicker";

test("renders an option per course", () => {
  render(
    <CoursePicker
      courses={[
        { slug: "a", name: "Alpha" },
        { slug: "b", name: "Beta" },
      ]}
      value="a"
      onChange={() => {}}
    />,
  );
  expect(screen.getByRole("option", { name: "Alpha" })).toBeDefined();
  expect(screen.getByRole("option", { name: "Beta" })).toBeDefined();
});
```

`dashboard/web/test/JobLog.test.tsx`:

```tsx
import { render, screen } from "@testing-library/preact";
import { JobLog } from "../src/components/JobLog";

test("shows lines and idle state", () => {
  const { rerender } = render(<JobLog job={null} lines={[]} />);
  expect(screen.getByText("No job running")).toBeDefined();
  rerender(
    <JobLog
      job={{ id: "1", kind: "sync", status: "running", startedAt: "", log: [] }}
      lines={["a", "b"]}
    />,
  );
  expect(screen.getByText(/a\nb/)).toBeDefined();
});
```

`dashboard/web/test/SyncCard.test.tsx`:

```tsx
import { render, screen } from "@testing-library/preact";
import { SyncCard } from "../src/components/SyncCard";

test("button disabled while a job runs", () => {
  render(
    <SyncCard
      job={{ id: "1", kind: "sync", status: "running", startedAt: "", log: [] }}
      busy={true}
      onRun={() => {}}
    />,
  );
  expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
});
```

- [ ] **Step 6: build + test + commit**

```
npm run --workspace ares-dashboard-web build
npm run --workspace ares-dashboard-web test
npx prettier --write "dashboard/web/**/*.{ts,tsx,css,html}"
```

```bash
git add dashboard/web package.json package-lock.json
git commit -m "feat(dashboard): web — Preact + Tailwind UI, 4 action cards + job log

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Glue — scripts, command, CI, tooling

**Files:**

- Create: `dashboard/package.json` (aggregator), `commands/ares-brain-dashboard.md`
- Modify: root `package.json`, `.github/workflows/ci.yml`, `eslint.config.js`, `.prettierignore`, `.gitignore`, `README.md`

- [ ] **Step 1: `dashboard/package.json` (dev aggregator, NOT a workspace member)**

```json
{
  "name": "ares-dashboard",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "concurrently -k -n web,server \"npm:dev:web\" \"npm:dev:server\"",
    "dev:web": "npm run --workspace ares-dashboard-web dev",
    "dev:server": "npm run --workspace ares-dashboard-server dev",
    "build": "npm run --workspace ares-dashboard-web build && npm run --workspace ares-dashboard-server build",
    "start": "npm run --workspace ares-dashboard-server start",
    "test": "npm run --workspace ares-dashboard-server test && npm run --workspace ares-dashboard-web test"
  },
  "devDependencies": { "concurrently": "^9.0.0" }
}
```

Because the glob is `dashboard/*`, this file makes `dashboard/` itself a workspace too — that is fine (it has scripts, no source). Root `npm install`.

- [ ] **Step 2: root `package.json`**

Add scripts:

```json
"dashboard": "npm run --workspace ares-dashboard dev",
"dashboard:build": "npm run --workspace ares-dashboard build"
```

Change `check` to also build the dashboard:

```json
"check": "prettier --check . && eslint . && npm run --workspace mcp check && npm run dashboard:build"
```

- [ ] **Step 3: `eslint.config.js`**

Replace the single `files: ["mcp/**/*.{ts,js,mjs,cjs}"]` block's glob with
`["mcp/**/*.{ts,js,mjs,cjs}", "dashboard/**/*.{ts,tsx}"]` and add to that block's
`languageOptions.globals`: `EventSource: "readonly"`, `fetch: "readonly"`,
`FormData: "readonly"`, `Response: "readonly"`, `document: "readonly"`,
`HTMLSelectElement: "readonly"`, `HTMLInputElement: "readonly"`,
`HTMLPreElement: "readonly"`, `MessageEvent: "readonly"`, `FileList: "readonly"`,
`File: "readonly"`, `URL: "readonly"`. Add `ignores`: `"dashboard/**/dist/**"`.
For `.tsx`, add `settings` / parserOptions so `jsxImportSource` is `preact` is not
needed for lint — just ensure `@typescript-eslint` parses tsx (it does by default).
Add a scoped override turning `@typescript-eslint/no-non-null-assertion` off for
`dashboard/**` (the code uses `!` on DOM lookups).

- [ ] **Step 4: `.prettierignore` + `.gitignore`**

`.prettierignore` — add `dashboard/**/dist/`.
`.gitignore` — add:

```
dashboard/**/dist/
dashboard/web/dist/
dashboard/server/dist/
```

- [ ] **Step 5: `commands/ares-brain-dashboard.md`**

```markdown
---
description: Start the local ares-brain dashboard and print its URL.
---

Start the dashboard:

1. `REPO=$(git rev-parse --show-toplevel)`.
2. If `$REPO/dashboard/web/dist/index.html` is missing, run
   `npm run --prefix "$REPO" dashboard:build`.
3. `nohup npm run --prefix "$REPO" --workspace ares-dashboard start > /tmp/ares-brain-dashboard.log 2>&1 &`
4. Poll `http://127.0.0.1:4319/api/courses` (up to ~10s) until it answers.
5. Tell the user: open `http://127.0.0.1:4319`, logs at `/tmp/ares-brain-dashboard.log`,
   stop it with `pkill -f ares-dashboard-server`.

It binds `127.0.0.1` only. One long job (scrape / transcribe) runs at a time; the page
streams its log. `ARES_BRAIN_DASHBOARD_PORT` overrides the port.
```

- [ ] **Step 6: CI — `.github/workflows/ci.yml`**

Add a job:

```yaml
dashboard:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: 20, cache: npm }
    - run: npm ci
    - run: npm run --workspace ares-dashboard build
    - run: npm run --workspace ares-dashboard test
```

- [ ] **Step 7: README — new "Dashboard" section** (after "Daily job")

````markdown
## Dashboard

A localhost web UI: pick a course, run a sync, upload books or recordings, transcribe a
YouTube link, and watch the job log stream.

```bash
npm run dashboard          # dev — Vite on :5173 proxying the API on :4319
npm run dashboard:build    # then: npm run --workspace ares-dashboard start  (serves :4319)
```
````

Or `/mesa:ares-brain-dashboard` from Claude Code. Binds `127.0.0.1` only, no auth. One
long job at a time. Chat is phase 2.

```

- [ ] **Step 8: verify + commit**

```

npm install
npm run check
cd scraper && uv run pytest -q

````

```bash
git add -A
git commit -m "feat(dashboard): dev scripts, /mesa:ares-brain-dashboard, CI, README

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
````

---

## Task 5: Live run + docs

- [ ] **Step 1** — `npm run dashboard`, open `http://127.0.0.1:5173`.
- [ ] **Step 2** — course picker lists all courses; run **sync**, watch the log stream to completion, button re-enables.
- [ ] **Step 3** — upload a PDF to a course → it lands in `courses/<slug>/inbox/books/`, an `ingest` job runs.
- [ ] **Step 4** — paste a real short YouTube link + a title → `transcribe-url` job → a `courses/<slug>/transcripts/url-*.md` appears.
- [ ] **Step 5** — upload a small audio file → `transcribe-inbox` job → `transcripts/inbox-*.md`.
- [ ] **Step 6** — start a second job while one runs → the buttons stay disabled / the API returns 409.
- [ ] **Step 7** — `npm run dashboard:build && npm run --workspace ares-dashboard start`, open `http://127.0.0.1:4319`, repeat one action against the built bundle.
- [ ] **Step 8** — append `## F dashboard — live run <date>` to `docs/lms-api.md`: what worked, transcribe-url timing, any port/proxy notes. Commit.

---

## Self-Review

**Spec coverage:**

- §1 `dashboard/` workspace, Node http, busboy, 127.0.0.1, port 4319 → Task 2. ✓
- §1 Vite + Preact + Tailwind v4 → Task 3. ✓
- §1 shell-`claude -p` chatbot = phase 2 → not in this plan (a muted placeholder line only). ✓
- §1 one job at a time, in-memory, SSE, restart loses log → `jobs.ts` + `index.ts` SSE. ✓
- §1 `transcribe-url` + `transcribe --inbox` → Task 1. ✓
- §1 launch both ways → Task 4 scripts + command. ✓
- §1 duplicated python helper → `dashboard/server/src/lib/python.ts` (Task 2). ✓
- §3 every route → Task 2 Step 6 `index.ts`; job kinds table → `jobs.ts` `argv()`. ✓
- §4 `transcribe_url` shape, never raises; inbox path; frontmatter → Task 1 Step 3 + tests. ✓
- §5 components, Tailwind `@theme`, dark mode, behaviour → Task 3. ✓
- §6 scripts + command → Task 4. ✓
- §7 CI job, `npm run check`, eslint glob, prettier/gitignore → Task 4. ✓
- §8 out of scope — respected (no auth, no history, no GUIDE browsing). ✓

**Placeholder scan:** none. Task 4 Step 3 (eslint) describes edits to an existing file whose exact current contents the implementer must read — the change is spelled out (globs, globals list, override) rather than pasted, because the surrounding file is small and already in the repo. Acceptable.

**Type consistency:** `Job` shape identical in `jobs.ts` (server) and `api.ts` (web). `JobKind` union = `sync|ingest|transcribe-url|transcribe-inbox` in both `jobs.ts` and the server's `KINDS` guard and `api.startJob` callers in `app.tsx`. `startJob` server throws `BusyError` → route maps to 409 → `api.startJob` returns `{error}` → `app.tsx` shows `! <error>`. `transcribe_url` returns `{ok,path,...}` (Task 1) consumed only by the CLI + the job runner (which only cares about exit code). `readCourses()` → `{slug,name}` = `Course` in `api.ts`. ✓

**Dependency note:** `dashboard/server/src/lib/python.ts` duplicates ~30 lines from `mcp/src/lib/python.ts` by design (spec §1) — the two packages stay decoupled. Flag for the whole-branch review as accepted, not a finding.
