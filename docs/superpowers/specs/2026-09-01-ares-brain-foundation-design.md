# Ares Brain — Foundation (Sub-project A) Design

**Date:** 2026-09-01
**Status:** Draft for review
**Scope:** Sub-project A of 5. Foundation only. No brain, no calendar, no LLM reasoning.

---

## 1. Context

`pre-read-companion/` (sibling repo) already scrapes the Mesa students LMS for
pre-reads and runs a Flask + Gemini quiz UI. It stays untouched.

This project is a **new, separate repo** that turns Mesa coursework into a
Claude-Code-driven study agent covering ten objectives:

1. Google Calendar events for assignment due dates
2. Pre-class briefing ("what happens in class")
3. Assignment reminders 24h before due
4. Step-by-step assignment guidance
5. Test-prep question generation
6. Summaries of books recommended in class
7. Ingest of user "self-notes" (Anytype exports, dropped as files)
8. Transcription of class recordings → notes / todos
9. Per-course knowledge graph ("brain") for grounded Q&A
10. Daily 06:00 job: scrape + a "mindset" digest

### Decomposition and build order

Each sub-project gets its own spec → plan → implementation cycle.

| #     | Sub-project                                                                                 | Objectives                                         | Depends on |
| ----- | ------------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------- |
| **A** | Repo + plugin skeleton + scraper + `ingest`/`transcribe` tools + drop folder                | 6, 7, 8 (raw material in, transcribed, normalized) | —          |
| B     | Brain: markdown store + local embeddings + `brain_*` tools + `ares-brain-briefing` skill    | 9, 2                                               | A          |
| C     | Commands + skills: `ask`, `assignment-help`, `testprep`, `book-summary`                     | 4, 5, 6                                            | B          |
| D     | Calendar: OAuth + `calendar_sync` + assignment/event extraction                             | 1, 3                                               | A          |
| E     | `launchd` schedule + `mindset-digest` skill + `/mesa:ares-brain-course-daily` orchestration | 10, 3-delivery                                     | B, D       |

**This document specifies Sub-project A only.** B–E are listed for context and
will be re-brainstormed when reached.

### A is delivered in two phases

| Phase                                        | Stages                                                                                                             | Ship criterion                                                                                                                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A-scrape** (first)                         | A0 spike, A1 skeleton, A2 scraper, plus a `scrape` MCP tool + `/mesa:ares-brain-course-scrape` command             | Running `/mesa:ares-brain-course-scrape` pulls every course's assignments, attendance, outline, events, announcements, materials, and recordings to `courses/<Course>/raw/`. Real data on disk. |
| **A-ingest** (after reviewing the real data) | A2-transcribe (Whisper), `transcribe` + `ingest` tools, `/mesa:ares-brain-course-ingest`, the `normalized/` schema | `normalized/*.md` produced for every source type; drop-folder contract works.                                                                                                                   |

The `normalized/` schema (§5 A3) is **provisional** until real scraped data is
inspected at the A-scrape/A-ingest boundary. Sub-project B does not start until
A-ingest ships.

---

## 2. Locked decisions (cross-cutting)

- **Package form:** a Claude Code **plugin** (`mesa`), installed via
  `/plugin install`. Ships slash commands, skills, and one bundled MCP server.
- **Reasoning LLM:** Claude Code itself. No Anthropic API key, no SDK. MCP tools
  are deterministic and never call an LLM.
- **Languages:** MCP server in **TypeScript** (`@modelcontextprotocol/sdk`).
  **Python sidecar** (`scraper/`) for LMS scraping and Whisper only.
- **Local-first.** Data lives on disk under `courses/`, gitignored. macOS
  `launchd` drives the schedule (Sub-project E).
- **Embeddings** (Sub-project B): local `transformers.js`, `all-MiniLM-L6-v2`,
  offline. Not in A.
- **Recordings transcription:** local `faster-whisper`, audio never leaves the
  machine.
- **LMS auth:** `MESA_REFRESH_TOKEN` in `.env`. Refresh flow (confirmed 2026-09-01):
  `POST https://students.mesaschool.co.in/api/auth/refresh` with header
  `Content-Type: application/json`, `Cookie: refresh_token=<token>`, body `{}` →
  `{data:{accessToken}}` (15-min access token). **The refresh token rotates on
  every use**: the scraper MUST read the new `refresh_token` from the response
  `Set-Cookie` and write it back to `.env` atomically before doing anything else,
  or the next run is locked out. A spent token returns `KeyError`/`UNAUTHENTICATED`.
  Best-effort: on failure a stage skips rather than crashing (Sub-project E).
- **Delivery** (Sub-project E): `daily/<date>.md` file + `osascript` notification.

---

## 3. Repository layout

```
mesa/
  .claude-plugin/
    plugin.json                 name, version, mcp server registration
  commands/
    course-scrape.md
    course-ingest.md
  skills/                       (populated in B–E; empty dir in A)
  mcp/
    package.json
    tsconfig.json
    src/
      index.ts                  MCP server entry, tool registration
      config.ts                 loads config/mesa-api.json + .env
      tools/
        status.ts
        scrape.ts
        transcribe.ts
        ingest.ts
      lib/
        paths.ts                ARES_BRAIN_HOME resolution, course tree
        subprocess.ts           spawn python sidecar, stream output
        frontmatter.ts          YAML frontmatter read/write
    test/
      *.test.ts
  scraper/
    lms_scrape.py               copied from pre-read-companion, then extended
    mesa_api.py                 shared HTTP client (base URL, auth, retry)
    requirements.txt
    .python-version             3.12
    tests/
      fixtures/                 recorded API responses (no token)
      test_parse.py
  config/
    mesa-api.json               single source of truth for endpoints
  courses/                      DATA — gitignored
    _index.json                 course id ↔ name cache
    <Course Name>/
      raw/                      scraper output (json + downloaded files)
      inbox/                    USER drops files here
      recordings/               downloaded audio/video
      transcripts/              whisper output (*.md)
      normalized/               ingest output — stable interface for B
  daily/                        (E) gitignored
  docs/
    lms-api.md                  discovery-spike findings
    superpowers/specs/          this file
  .env.example
  .gitignore
  README.md
```

`.gitignore`: `courses/`, `daily/`, `.env`, `scraper/.venv/`, `mcp/node_modules/`,
`**/__pycache__/`, model caches.

---

## 4. `config/mesa-api.json`

```json
{
  "baseUrl": "https://api-students.mesaschool.co.in/api/v1",
  "frontendBase": "https://students.mesaschool.co.in",
  "authRefresh": "https://students.mesaschool.co.in/api/auth/refresh",
  "termIdOverride": null,
  "eventsWindowDays": 60,
  "endpoints": {
    "me": "/users/me",
    "assignmentsMy": "/assignments/my",
    "assignmentsByCourse": "/assignments",
    "attendanceSummary": "/attendance/student/summary",
    "eventsMy": "/events/my",
    "announcements": "/announcements",
    "courses": "/curriculum/courses",
    "topics": "/curriculum/topics",
    "topicMaterials": "/content/topics/{topicId}/materials",
    "topicRecordings": "/content/topics/{topicId}/recordings",
    "materialSignedUrl": "/content/materials/{materialId}/signed-url"
  },
  "notes": "Routes reverse-engineered from the LMS frontend + 2026-09-01 spike. See docs/lms-api.md."
}
```

- **`termId` is discovered at runtime**, not hardcoded: the scraper calls
  `/attendance/student/summary` first and takes `termId` from its rows (that URL's
  own term param — `7431dfa8...` from the community page — is a _pre-program_
  term with one course). `termIdOverride` is an escape hatch only.
- Course IDs are resolved at runtime from `/curriculum/courses?termId=` (union
  with the courses named in the attendance summary) and cached to
  `courses/_index.json`.
- Full endpoint shapes, the token-rotation rule, and per-endpoint gotchas live in
  `docs/lms-api.md`. Both Python (`json.load`) and TypeScript (`import`) read
  this config file. No second copy.

---

## 5. Sub-project A stages

### A0 — LMS discovery spike

**Input:** one fresh `MESA_REFRESH_TOKEN` (user-provided).

**Do:** call each endpoint in section 4 once, for one real course
(Business Frameworks, `41e90532-d355-4d05-903d-df8dff2ccaa7`), plus resolve its
topic IDs and hit `topicMaterials` / `topicRecordings` for one topic.

**Produce:** `docs/lms-api.md` documenting, per endpoint:

- exact URL + query params
- response JSON shape (field names, types, nesting)
- for `assignmentsMy`: which fields carry due date, status, submission state,
  course linkage
- for `attendanceSummary`: whether it reports **total sessions conducted** (used
  for session detection) vs only personal attendance
- for `eventsMy`: event types present, which correspond to assignment deadlines
- for `topicRecordings`: whether a recording is a **downloadable signed URL** or
  an **external stream link** (Zoom/Vimeo/etc.)
- auth: does the refresh endpoint rotate-and-invalidate, or tolerate repeated use

**Gate:** A2 parsing code is written against these findings, not guesses. If a
recording turns out to be a stream link, the transcription path for streamed
recordings is deferred and recorded as a limitation.

**Also:** confirm whether `lms_scrape.py`'s existing base path needs the `/api/v1`
prefix (README route map omits it; the captured URLs include it).

### A1 — repo + plugin skeleton

- `git init`; write `.gitignore`, `.env.example`, `README.md` stub.
- `.claude-plugin/plugin.json`: plugin name, version, and MCP server registration
  pointing at `mcp/` (stdio, `node mcp/dist/index.js` or `tsx mcp/src/index.ts`).
- `mcp/`: TypeScript project. `npm i @modelcontextprotocol/sdk`. Build with `tsx`
  for dev, `tsc` for the shipped `dist/`.
- `scraper/`: copy `lms_scrape.py` from `pre-read-companion`. Create venv with
  `uv venv --python 3.12`, `uv pip install -r requirements.txt`. (`faster-whisper`
  - `yt-dlp` are added in the A-ingest phase, not A-scrape.)
- `config/mesa-api.json` from section 4.
- **One working tool: `status`** (section 6). Verifies the plugin loads in
  Claude Code and paths resolve. Manual check documented in README.

### A2 — scraper modules

Refactor `lms_scrape.py` around a shared `mesa_api.py` client (base URL from
config, bearer from refreshed token, one retry on 5xx / transient error).
Add subcommands, each writing under `courses/<Course>/raw/`:

Global outputs live at `courses/_index.json` and `courses/_meta.json`; per-course
outputs at `courses/<slug>/raw/`.

| Subcommand      | Output file                                                                             | Contents                                                                                                                                                                                                                                                                                                                                                                         |
| --------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `courses`       | `courses/_index.json`, `courses/_meta.json`                                             | `_index`: `[{id, name, slug, instructorName, courseType, classType}]` for the discovered term (union of `/curriculum/courses` and attendance rows). `_meta`: `{termId, termName, studentId, scrapedAt}`                                                                                                                                                                          |
| `assignments`   | `raw/assignments.json` (per course) + `courses/_assignments-unassigned.json`            | dedupe-by-`id` merge of `/assignments/my` and per-course `/assignments?status=published`. Keep fields: `{id, title, courseId, courseName, topicId, instructions, submissionType, isGroup, dueAt, cutoffDate, allowLate, status, mySubmissionStatus, materials, createdAt}`. Items with null `courseId` that can't be resolved via `topicId` go to `_assignments-unassigned.json` |
| `attendance`    | `courses/_attendance.json`                                                              | raw `/attendance/student/summary` array + per course `{courseId, sessionsConducted: total, attended, percentage, avgCp}`                                                                                                                                                                                                                                                         |
| `events`        | `courses/_events.json`                                                                  | one `/events/my` call, window `± eventsWindowDays`. Store items whole; add derived `{courseSlug}` where `courseId` resolves                                                                                                                                                                                                                                                      |
| `announcements` | `courses/_announcements.json` (program-wide) + `raw/announcements.json` (course-scoped) | paginate until `publishedAt` older than 90 days or 5 pages, whichever first                                                                                                                                                                                                                                                                                                      |
| `topics`        | `raw/topics.json`                                                                       | `/curriculum/topics?courseId=` verbatim: `[{id, courseId, title, type, sequence}]`                                                                                                                                                                                                                                                                                               |
| `materials`     | `raw/materials.json` + `raw/files/<materialId>.<ext>`                                   | for every topic of the course: `/content/topics/{topicId}/materials`. For `kind:file` + `allowDownload`, resolve `/content/materials/{id}/signed-url` and download to `raw/files/`. Manifest keeps `{id, topicId, topicType, title, category, kind, session, resourceSessionId, fileName, fileType, sizeBytes, localPath, content, updatedAt}`                                   |
| `recordings`    | `raw/recordings.json`                                                                   | from the course's `recordings`-type topic: `[{id, title, videoUrl, provider, embedUrl, recordedOn, durationSec}]`. No download in A-scrape                                                                                                                                                                                                                                       |

- `slug` = filesystem-safe course name; directory names use it.
- All subcommands: resumable, skip files already on disk, print a one-line
  summary per course.
- **Recordings are all YouTube links** (`provider: "youtube"`, spike-confirmed) —
  there is no downloadable-file case. A-scrape writes
  `raw/recordings.json` with `{id, title, videoUrl, provider, recordedOn}`.
  A-ingest's `transcribe` runs `yt-dlp` to pull audio → `faster-whisper`. On any
  `yt-dlp` failure the entry is marked `status: "needs-manual"` and the daily job
  (Sub-project E) asks the user to drop the file into `inbox/`. The scrape never
  fails over a recording.
- `all` subcommand runs every step for every course. This is what the `scrape`
  MCP tool calls.
- `fetch` (existing) stays as an alias for `materials` on the prereads topic
  only, for backward compat with `pre-read-companion` habits.
- The token is refreshed once at run start via `authRefresh`; the rotated
  `refresh_token` from `Set-Cookie` is persisted to `.env` **atomically before
  any API call**; the access token is reused for the run and re-refreshed on a
  mid-run 401 (see `docs/lms-api.md`).

### A3 — MCP tools

Deterministic wrappers. Each spawns the Python sidecar or does file IO. None
call an LLM.

- **`scrape({ course?, kinds? })`** — runs the relevant `lms_scrape.py`
  subcommands via `scraper/.venv/bin/python`. `kinds` defaults to all. Returns
  `{ perCourse: [{ course, fetched, skipped, errors }], tokenRefreshed: bool }`.
- **`transcribe({ course? })`** — for each audio/video file in `recordings/` and
  `inbox/**/*.{mp3,mp4,m4a,wav}` without a matching `transcripts/<name>.md`:
  run `faster-whisper` (model size from `.env`, default `base`), write
  `transcripts/<name>.md` with frontmatter `{type: transcript, source, course,
recordedAt?}` and body = segments with `[hh:mm:ss]` markers. Returns
  `{ transcribed: [...], skipped: [...] }`.
- **`ingest({ course? })`** — normalizes everything into
  `courses/<Course>/normalized/*.md`, one file per source item, with frontmatter:
  ```
  type: preread | material | assignment | assignment-mywork | outline-session
      | attendance | event | announcement | transcript | self-note | book
  source: <relative path or API id>
  title: ...
  course: <Course Name>
  session: <int, if known>
  due: <ISO 8601, if applicable>
  updatedAt: <ISO 8601>
  ```
  Body = extracted text (reuse `pre-read-companion` extractors for PDF/DOCX/PPTX;
  new: JSON → readable markdown for assignments/outline/events).
  **Drop-folder contract** for `inbox/<Course>/`:
  | Pattern                                                                      | `type`                                    |
  | ---------------------------------------------------------------------------- | ----------------------------------------- |
  | `*.md`, `*.txt`                                                              | `self-note`                               |
  | `*.pdf` whose name matches a known assignment title                          | `assignment` attachment                   |
  | other `*.pdf`, `*.epub`                                                      | `book`                                    |
  | `*.mp3/.mp4/.m4a/.wav`                                                       | routed to `transcribe`, then `transcript` |
  | `normalized/` is the **stable interface** Sub-project B consumes. Its schema |
  | changing is a breaking change for B.                                         |
- **`status()`** — section 6.

### A4 — commands

- `/mesa:ares-brain-course-scrape [course]` → calls `scrape` then reports the summary.
- `/mesa:ares-brain-course-ingest [course]` → calls `transcribe` then `ingest`, reports counts.

Thin wrappers; the real orchestration for the daily run is Sub-project E.

---

## 6. `status` tool (the A1 smoke test)

Returns:

```json
{
  "home": "/Users/.../ares-brain",
  "configLoaded": true,
  "tokenPresent": true,
  "tokenExpiresAt": "2026-09-30T...", // decoded from JWT exp, no secret echoed
  "pythonSidecar": "ok | missing venv | missing faster-whisper",
  "courses": [
    {
      "name": "Business Frameworks",
      "raw": 12,
      "inbox": 2,
      "transcripts": 1,
      "normalized": 0
    }
  ],
  "lastScrape": "2026-09-01T06:00:12Z | never"
}
```

No token value, no PII from the JWT payload beyond the expiry timestamp.

---

## 7. Session detection

`sessionIndex` = **number of classes conducted so far**, independent of personal
attendance.

- **Primary source (spike-confirmed):** `/attendance/student/summary` → the
  course's `total` field is exactly "sessions conducted so far". `attended` is
  personal attendance and is _not_ used here.
- **Next class** = the earliest `/events/my` event with `eventType == "session"`,
  matching `courseId`, and `startAt` in the future.
- The per-session _topic_ ("what is session 6 about") is NOT in the API — the
  course outline is a Google Sheet link (design §10 open item). Best available
  signal in A/B is prereads carrying a `session` number.
- Attendance data is still ingested (`type: attendance`) for the brain.

Consumed by the `ares-brain-briefing` skill in Sub-project B, not used in A.

---

## 8. Testing

- **Scraper:** A0 records one real JSON response per endpoint into
  `scraper/tests/fixtures/` (scrubbed of PII where practical). `test_parse.py`
  asserts each normalizer produces the expected `raw/*.json` shape, offline, no
  token. CI never needs a live token.
- **MCP tools:** `vitest`. Each test sets `ARES_BRAIN_HOME` to a temp dir with
  a fake course tree, runs the tool, asserts files created and JSON returned.
  `transcribe` uses a committed 10-second `.wav` fixture and the smallest Whisper
  model; assertion is "a non-empty transcript file with valid frontmatter", not
  exact text.
- **`ingest`:** table test — one input file per `type`, assert frontmatter +
  non-empty body.
- **Plugin load:** manual, documented step in README ("`/plugin install .`, then
  ask Claude Code to run the `status` tool, expect ...").

---

## 9. Explicitly out of scope for A

Embeddings, the brain markdown store, retrieval, any `brain_*` tool, Google
Calendar / OAuth, the daily digest, `launchd`, the `mindset-digest` /
`briefing` / `assignment-solver` / `testprep-writer` / `book-summary` /
`graph-refine` skills, and any code path that calls an LLM.

---

## 10. Resolved

1. **Streamed recordings:** all recordings are YouTube links (spike-confirmed).
   `yt-dlp` is acceptable to pull audio in A-ingest. On failure the entry is
   marked `needs-manual` and the daily job asks the user to drop the file into
   `inbox/`. (§5 A2.)
2. **Books:** agent identifies the recommended book from notes/transcripts; the
   user uploads the PDF/EPUB into `inbox/` manually. No automated acquisition.
3. **Terms:** `termId` is discovered at runtime from
   `/attendance/student/summary` (§4), not hardcoded — the spike showed the
   community-page term is a pre-program one. `termIdOverride` in config is the
   only knob. Multi-term is deferred.

## 11. Open items (post-spike)

1. **Course outline is a Google Sheet.** The `outline` material is a link to a
   Google Sheets doc; the class-by-class schedule (session № → topic → date) is
   not in the API. Options for Sub-project B: (a) read the sheet via a public
   CSV export URL if the sheet is link-shared, (b) ask the user to paste the
   outline into `inbox/` once per course, (c) derive a rough schedule from
   `session`-numbered prereads + `events/my` session dates. Decide in B.
2. **`/content/materials/{id}/signed-url`** was not re-confirmed in the spike
   (frontend route map only). A-scrape task for `materials` must verify it and
   fall back to skipping file download (manifest-only) if the shape differs.
3. **Leader/club assignments** (`courseId: null`, `leaderId` set) — bucket under
   a synthetic `_unassigned` course for now; revisit if the user opts into more
   clubs.
