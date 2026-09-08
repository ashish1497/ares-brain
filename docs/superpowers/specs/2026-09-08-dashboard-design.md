# F — local dashboard (phase 1)

**Date:** 2026-09-08
**Status:** Approved
**Scope:** A localhost web dashboard for ares-brain: pick a course, trigger a sync,
upload books, upload recordings, paste a YouTube link to transcribe, and watch the
running job's log stream. **Chatbot is phase 2** — its own spec.

---

## 1. Decisions

| Question                | Decision                                                                                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Where                   | New `dashboard/` npm workspace (sibling of `mcp/`).                                                                                                                                                                |
| Server                  | Node + TypeScript, Node's built-in `http` + a tiny hand-rolled router. `busboy` for multipart uploads. No Express. Binds `127.0.0.1` only, no auth. Port `ARES_BRAIN_DASHBOARD_PORT` (default `4319`).             |
| Frontend                | Vite + Preact + Tailwind v4 (`@tailwindcss/vite`, `@theme` tokens). Single page, no router. Built output served by the Node server; in dev, Vite proxies `/api` → server.                                          |
| Chatbot brain (phase 2) | Shell `claude -p` per message. Not built here.                                                                                                                                                                     |
| Jobs                    | One at a time. In-memory job record + ring-buffered log + SSE stream. A server restart loses the log and kills the child (accepted).                                                                               |
| Transcribe input        | New `lms_scrape.py transcribe-url` subcommand; new `transcribe --inbox` flag for uploaded audio.                                                                                                                   |
| Launch                  | `npm run --workspace dashboard dev` (primary) + `/mesa:ares-brain-dashboard` command (starts `start` backgrounded, prints the URL).                                                                                |
| Shared spawn helper     | `dashboard/server/lib/python.ts` **duplicates** the ~40-line spawn-and-stream helper from `mcp/src/lib/python.ts` rather than coupling the MCP stdio package to the dashboard. Documented as accepted duplication. |

## 2. Cross-cutting constraints (still binding)

- Python sidecar does the deterministic work. The dashboard server only spawns
  `uv run python lms_scrape.py …` (with `ARES_BRAIN_HOME` set) and serves files.
- **No LLM call anywhere in phase 1.**
- `.env` / `client_secret.json` / `token.json` never read or served by the dashboard.
- `courses/` + `daily/` stay gitignored; `dashboard/dist*` gitignored.
- Every new Python entry point reads `courses/` off disk; `transcribe-url` is the only
  one that hits the network (yt-dlp), and it never raises — returns `{ok, …}`.

## 3. Server — `dashboard/server/`

`index.ts` starts `http.createServer`, binds `127.0.0.1:<port>`, logs the URL.

### Routes

| Method / path                                         | Behaviour                                                                                                                                                                                                                                          |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/courses`                                    | `courses/_index.json` → `[{slug, name}]`. `[]` if the file is absent.                                                                                                                                                                              |
| `GET /api/state`                                      | `{ job: <current Job or null>, lastRuns: { <kind>: { finishedAt, exitCode } } }`                                                                                                                                                                   |
| `POST /api/jobs`                                      | Body `{ kind, course?, url?, title? }`. `202 {jobId}` on start, `409 {error:"busy", job}` if one is running. Kinds below.                                                                                                                          |
| `GET /api/jobs/:id/log`                               | `text/event-stream`. Replays the buffered log, then streams `data: <line>\n\n` per output line, ends with `event: end\ndata: {"exitCode":N}`.                                                                                                      |
| `POST /api/upload?course=<slug>&kind=book\|recording` | multipart. Writes each part to `inbox/<slug>/{books\|recordings}/<sanitised name>`. `book` accepts `.pdf .docx`; `recording` accepts `.m4a .mp3 .wav .mp4 .webm`. Returns `{written:[names], rejected:[{name,reason}]}`. Does **not** start a job. |
| `GET /` and static                                    | Serves `web/dist/` (prod). 404 → `index.html` (SPA fallback).                                                                                                                                                                                      |

### Job kinds

| kind               | command                                                                        |
| ------------------ | ------------------------------------------------------------------------------ |
| `sync`             | `lms_scrape.py all` — always every course; the course picker does not gate it. |
| `ingest`           | `lms_scrape.py ingest` (all) or `--course <slug>`                              |
| `transcribe-url`   | `lms_scrape.py transcribe-url --course <slug> --url <url> [--title <t>]`       |
| `transcribe-inbox` | `lms_scrape.py transcribe --course <slug> --inbox`                             |

### `lib/jobs.ts`

```
type Job = {
  id: string; kind: string; course?: string;
  status: "running" | "done" | "failed";
  startedAt: string; finishedAt?: string; exitCode?: number;
  log: string[];           // ring-capped at 2000 lines
};
let current: Job | null = null;
const lastRuns: Record<string, {finishedAt: string; exitCode: number}> = {};
```

- `start(kind, opts)` → throw `BusyError` if `current?.status === "running"`.
  Build argv, spawn via `lib/python.ts`, stream lines into `job.log` + every attached
  SSE writer. On `close`: set `status` (`exitCode === 0 ? "done" : "failed"`),
  `finishedAt`, `lastRuns[kind]`. `current` stays set (panel shows the finished result)
  until the next `start`.
- `attach(res)` / `detach(res)` manage SSE writers.

### `lib/python.ts` (duplicated from mcp)

`runPython(args: string[], onLine: (l: string) => void): Promise<{ code: number }>` —
`spawn(venvPython(), ["lms_scrape.py", ...args], { cwd: <repo>/scraper, env: { …process.env, ARES_BRAIN_HOME: repoRoot() } })`, line-buffer stdout+stderr → `onLine`, resolve on close. `venvPython()` / `repoRoot()` copied too.

## 4. New Python — `scraper/`

### `transcribe.py`

- `transcribe_url(slug: str, url: str, title: str | None = None) -> dict`
  - `yt-dlp -x --audio-format m4a -o <tmp> <url>` → whisper (reuse the existing model
    wrapper) → write `courses/<slug>/transcripts/url-<sha1(url)[:10]>.md`:
    frontmatter `type: transcript`, `source: "url:<url>"`, `title`, `recordedOn`,
    body = `[hh:mm:ss]` lines.
  - Any failure (bad url, yt-dlp throttle, whisper error) → `{ok: False, error: <msg>}`,
    never raises. Success → `{ok: True, path, url, title}`.
- Extend the inbox path: `step_transcribe(..., inbox: bool = False)` (or a sibling
  `transcribe_inbox(slug)`) — iterate `inbox/<slug>/recordings/*.{m4a,mp3,wav,mp4,webm}`,
  whisper each, write to `transcripts/`, move the source to
  `inbox/<slug>/recordings/_done/`. Per-file try/except; returns a summary dict.

### `lms_scrape.py`

- `transcribe-url --course <slug> --url <url> [--title <t>] [--json]` → `transcribe_url`.
- `transcribe` gains `--inbox` (with `--course`) → the inbox path.
- Both read `courses/` off disk. `transcribe-url` needs no LMS auth.

### Tests (`scraper/tests/`)

- `test_transcribe_url.py` — monkeypatch the yt-dlp call + the whisper wrapper; assert
  the transcript file, frontmatter, `{ok:True}`; a raising yt-dlp → `{ok:False}` no throw.
- `test_transcribe_inbox.py` — drop two fake audio files, monkeypatch whisper, assert
  transcripts written + sources moved to `_done/`.
- CLI: `test_cli.py` gains `transcribe-url` + `transcribe --inbox` dispatch cases.

## 5. Frontend — `dashboard/web/`

Vite + Preact + Tailwind v4. `src/`:

- `main.tsx`, `App.tsx`
- `api.ts` — `getCourses()`, `getState()`, `startJob(body)`, `streamLog(jobId, onLine, onEnd)` (EventSource), `upload(course, kind, files)`.
- `components/` — `CoursePicker`, `SyncCard`, `UploadCard` (books + recordings, `kind` prop), `YouTubeCard`, `JobLog`, `Card` (shell).
- **Layout** (approved mockup): header (brand + `CoursePicker`) · 2×2 card grid
  (`Sync from Nexus`, `Add books`, `Add recordings`, `YouTube transcribe`) · full-width
  `JobLog` strip below · a muted "Chat — phase 2" line.
- **Behaviour**
  - On load: `getCourses()` + `getState()`.
  - No job running → poll `getState()` every 3 s; strip shows the last run per kind.
  - Job running → the start buttons across all cards disable with "sync running" (etc.);
    `JobLog` opens an `EventSource` and appends lines (mono, auto-scroll); on `end` it
    stops, re-enables buttons, refreshes state.
  - `Add books`: upload → then POST an `ingest` job (course-scoped).
  - `Add recordings`: upload → then POST `transcribe-inbox`.
  - `YouTube`: POST `transcribe-url` with the field value.
- **Tailwind theme** — `@theme` with `--color-surface-*`, `--color-text-*`,
  `--color-border`, `--radius-card`. Dark mode: `@media (prefers-color-scheme: dark)`
  overrides + a `.dark` class the header can toggle (default: follow system).
- Polished-minimal: one accent, generous spacing, hairline borders, works in both modes.

### Tests (`dashboard/web/`)

Preact Testing Library + vitest, light: `CoursePicker` renders the options it's given;
`JobLog` appends lines pushed to its `onLine`; `SyncCard` button disables when
`job.status === "running"`.

## 6. Launch + command

- `dashboard/package.json` scripts:
  - `dev` — `concurrently "vite" "tsx watch server/index.ts"` (Vite on 5173 proxying
    `/api` → 4319; server on 4319).
  - `build` — `vite build` (→ `web/dist`) + `tsc -p server` (→ `server/dist`).
  - `start` — `node server/dist/index.js` (serves `web/dist`).
  - `test` — `vitest run`.
- `commands/ares-brain-dashboard.md` (`/mesa:ares-brain-dashboard`): resolve the repo
  root, `npm run --workspace dashboard build` if `web/dist` is missing, then
  `nohup npm run --workspace dashboard start >/tmp/ares-brain-dashboard.log 2>&1 &`,
  wait for the port, print `http://127.0.0.1:4319`. Note it needs the repo + a build.

## 7. CI + tooling

- `.github/workflows/ci.yml` — new `dashboard` job: `npm ci` →
  `npm run --workspace dashboard build` → `npm run --workspace dashboard test`.
- Root `npm run check` gains `npm run --workspace dashboard build`.
- `eslint.config.js` — extend the `files` glob to `dashboard/**/*.{ts,tsx}` (Preact:
  add the jsx settings). `.prettierignore` — add `dashboard/**/dist/`.
- `.gitignore` — `dashboard/**/dist/`, `dashboard/server/dist/`.

## 8. Out of scope (phase 1)

Chatbot; auth / LAN / HTTPS; concurrent jobs; job history or persistence; browsing
`GUIDE.md` / editing `course.md` in the UI; per-course sync.

## 9. Build order

1. **Python** — `transcribe_url` + `transcribe --inbox` + CLI + tests. No dashboard yet.
2. **Server** — `dashboard/server/` job runner, routes, upload; vitest.
3. **Web** — Vite + Preact + Tailwind scaffold; the 4 cards + `JobLog`; component tests.
4. **Glue** — `dev`/`build`/`start` scripts, `/mesa:ares-brain-dashboard` command, CI job, `npm run check`, README "Dashboard" section.
5. **Live run** — `dashboard dev`, exercise all four actions against real data; record in `docs/lms-api.md`.

Subagent-driven, TDD.
