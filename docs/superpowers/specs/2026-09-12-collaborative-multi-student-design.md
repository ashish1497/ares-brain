# Collaborative multi-student ares-brain — design

**Date:** 2026-09-12
**Status:** Approved (brainstorm), pending spec self-review sign-off
**Scope:** Restructure ares-brain so a whole course cohort can use it, not just one
student — without becoming a hosted multi-tenant service. Local-first stays;
a shared Google Drive folder per course becomes the sync layer for the data
that's identical across students. Adds a hard onboarding gate, a chat-driven
command surface in the dashboard, and opt-in sharing for notes/testprep.

## Locked decisions (from the 2026-09-12 brainstorm)

| Decision                             | Answer                                                                                                                                                                                                                                                |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deployment model                     | Each student keeps running their **own local plugin + dashboard**. No hosted multi-tenant service, no new database, no per-student accounts on a server.                                                                                              |
| Cohort discovery                     | **Admin-created Drive folder per course**, folder ID published in a checked-in config file. No invite-code/join-request system.                                                                                                                       |
| Materials/outline/announcements      | **Shared** — identical across the cohort, dedup by content hash, written once.                                                                                                                                                                        |
| Assignments/grades/submission status | **Local only** — per-student by definition, never uploaded.                                                                                                                                                                                           |
| Attendance                           | **Local only, never touches Drive.** Explicitly excluded from every sharing mechanism below.                                                                                                                                                          |
| Recordings' transcripts              | **Shared** — expensive to regenerate; one transcription serves the cohort.                                                                                                                                                                            |
| `GUIDE.md` (per course)              | **Shared** — built once, everyone reads the same synthesis.                                                                                                                                                                                           |
| Calendar sync                        | **Local/personal** — each student's own Google Calendar, unaffected by any of this.                                                                                                                                                                   |
| Student notes                        | **Local by default**, opt-in "share this note" uploads to a per-student subfolder in the shared folder. Referenceable by others once shared.                                                                                                          |
| Testprep sets                        | **Local by default**, opt-in "share this testprep" uploads + returns a Drive shareable link. Never auto-shared.                                                                                                                                       |
| Shared-notes attribution             | **Attributed** (`by: <student-name>`), using Drive's own uploader metadata — not anonymized.                                                                                                                                                          |
| Onboarding gate                      | **Hard gate.** The dashboard serves nothing but the setup screen until Drive access, Calendar access, and a valid Mesa refresh token are all present — plus (new, this spec) a working `claude -p` login, since the chatbot below depends on it.      |
| Drive OAuth scope                    | **Picker + `drive.file`**, not broad `drive`/`drive.readonly`. The student picks the shared cohort folder once via Google's file picker, which grants the app read/write on that folder (and its subtree) without ever requesting "see all of Drive." |
| In-dashboard chatbot execution       | **Shells out to `claude -p`**, reusing the existing skills unchanged. No skill logic gets reimplemented as standalone Gemini-calling TypeScript.                                                                                                      |

## Architecture

```
Student A's machine                    Student B's machine
┌─────────────────────┐                ┌─────────────────────┐
│ ares-brain (local)   │                │ ares-brain (local)   │
│  courses/<slug>/...  │                │  courses/<slug>/...  │
│  dashboard (setup-   │                │  dashboard (setup-   │
│   gated until ready) │                │   gated until ready) │
└──────────┬───────────┘                └──────────┬───────────┘
           │  read shared-first, write-if-absent    │
           ▼                                        ▼
        ┌─────────────────────────────────────────────┐
        │   Shared Google Drive folder (per course)     │
        │   materials/  transcripts/  guide/             │
        │   notes/<student>/   testprep/<student>/       │
        └─────────────────────────────────────────────┘
```

Nothing server-side changes about _how_ a student runs ares-brain. What
changes is: (a) a new Drive-backed data layer some scrape/ingest/brain steps
consult before doing local work, (b) a hard setup gate in front of the
dashboard, (c) a chat surface in the dashboard that shells to `claude -p`.

## A. Data classification

| Data                                   | Location             | Mechanism                                      |
| -------------------------------------- | -------------------- | ---------------------------------------------- |
| Materials, outline, announcements      | Shared               | content-hash dedup, write-once                 |
| Transcripts                            | Shared               | write-once per recording                       |
| `GUIDE.md`                             | Shared               | write-once per course, rebuildable             |
| Assignments, grades, submission status | Local only           | unchanged                                      |
| Attendance                             | Local only           | unchanged, never touches Drive                 |
| Calendar sync                          | Local/personal       | unchanged (each student's own Google Calendar) |
| Notes                                  | Local + opt-in share | per-student subfolder                          |
| Testprep                               | Local + opt-in share | per-student subfolder, returns shareable link  |
| OAuth/refresh tokens                   | Local only           | never shared, never uploaded                   |

## B. Drive layout + course→folder mapping

```
<course-slug>/
  materials/           # shared scrape output, content-hash-named files
  transcripts/         # shared, one file per recording
  guide/GUIDE.md         # shared, one per course
  notes/<student-name>/   # opt-in uploads
  testprep/<student-name>/
```

New checked-in config: `config/course-drive-folders.json`, `{ "<course-slug>":
"<drive-folder-id>" }`. An admin (or whoever runs setup first for a course)
creates the Drive folder, shares it with the cohort via Drive's own sharing
UI, and commits the folder ID. This repo doesn't build any invite-code or
membership system — folder sharing is Drive's job.

## C. Auth + the onboarding gate

### C.1 Google OAuth (Drive + Calendar, one consent)

Today's `calendar_sync.py` owns its own `_SCOPES`, `_client_secret_path()`,
`_token_path()`, `_service()`, `do_auth()` — all Calendar-specific. This spec
generalizes that into a shared auth module:

- New `scraper/google_auth.py`: owns `_client_secret_path()`/`_token_path()`
  (unchanged locations/env-var overrides), a combined `_SCOPES` list
  (`https://www.googleapis.com/auth/calendar` + `https://www.googleapis.com/auth/drive.file`),
  and a generic `service(api_name: str, version: str)` — replacing
  `calendar_sync._service()`'s body. `calendar_sync.py` calls
  `google_auth.service("calendar", "v3")` instead of owning the OAuth
  plumbing itself.
- `do_auth()` moves to `google_auth.py` too; `calendar_sync.do_auth` becomes
  a thin re-export for backward compatibility (existing `calendar-auth` CLI
  subcommand keeps working unchanged).
- One consent screen grants both scopes — a student never sees two separate
  Google auth prompts for this.
- **Drive folder selection uses the Google Picker API** (a small piece of
  client-side JS the dashboard's setup screen loads), scoped with
  `drive.file`. The student picks the shared cohort folder once **per
  course** the first time they touch that course; the picker's grant makes
  that folder (and everything under it) accessible to future `drive.file`
  calls without re-prompting. This is Google's documented pattern for "app
  needs access to one pre-existing, pre-shared folder" and avoids ever
  requesting broad Drive read access.
- New `scraper/drive_sync.py`: `read_or_none(course_slug, subpath)`,
  `write_if_absent(course_slug, subpath, content, content_hash)`,
  `upload_shared(course_slug, subpath, local_path) -> shareable_link`. Reads
  `config/course-drive-folders.json` for the folder ID, uses the picker-
  granted per-folder access token. Never touches attendance/assignments —
  those code paths aren't given a drive_sync call at all, by construction.

### C.2 The gate itself

New `scraper/setup_state.py`: `check_setup() -> {"driveConnected": bool,
"calendarConnected": bool, "mesaTokenPresent": bool, "claudeCliLoggedIn":
bool}`. Four checks, not three — see the callout below.

- `driveConnected` — the base Drive OAuth token exists and is
  valid/refreshable (same shape of check `calendar_sync._service()` already
  does for Calendar). This gates _dashboard access_, not per-course setup:
  the Picker's per-course folder grant (C.1) happens lazily, the first time
  that specific course's shared data is touched (its first scrape/ingest),
  not upfront for every course the student might ever take. A student can
  reach the dashboard as soon as the base Drive grant exists.
- `calendarConnected` — `token.json` exists and is valid/refreshable
  (same check `calendar_sync._service()` already does internally).
- `mesaTokenPresent` — `.env`'s `MESA_REFRESH_TOKEN` is present (existing
  check, not new).
- `claudeCliLoggedIn` (**new — not in the original three-item list**) — a
  cheap non-mutating `claude -p` probe succeeds. This is being added because
  the in-dashboard chatbot (section G) shells out to `claude -p`, and this
  session just spent real time diagnosing exactly this failure mode for the
  daily/evening jobs (a separately-authenticated CLI binary whose login can
  be silently revoked). Gating on it at setup time surfaces the problem
  once, with a clear fix (`claude setup-token`), instead of it resurfacing
  invisibly the first time a student tries the chatbot.

**Dashboard server enforcement:** `dashboard/server/src/index.ts`'s router
gains a check, before any other route matches, equivalent to: if
`check_setup()` reports any false and the request isn't for `/setup` or its
supporting API (`GET /api/setup-state`, `POST /api/setup/*`), respond with
whatever keeps the SPA on the setup screen (a 200 that the web app's router
treats as "render setup only," not scattered 403s across every route) —
worked out precisely during planning. The web app gets a new top-level
`SetupGate` component that owns this screen and blocks rendering
`<App>`'s real tabs until all four checks pass.

## D. Shared-first sync mechanics

For materials, transcripts, and `GUIDE.md`: before generating or scraping
locally, check the shared Drive folder (`drive_sync.read_or_none`) by
filename and content hash — reusing the same `bodyHash`/manifest-hash
mechanism `ingest.py` already computes for local change detection, not a
new hashing scheme. If present, download and use it as-is — skip local
generation entirely. If absent, do the local work as today, then
`upload_shared` it for the cohort.

**Race handling:** if two students transcribe the same recording at nearly
the same time, whoever uploads first wins; the loser's local copy is
superseded on the next sync pass (hash mismatch triggers a re-read from
Drive). No locking is built — the cost of an occasional duplicate
transcription is far lower than the cost of building real distributed
coordination for a handful of students.

## E. Notes: local + shared, merged into search

Unchanged: notes stay local-first, written under `inbox/<slug>/notes/` as
today. New: an explicit "share this note" action (dashboard button or a CLI
subcommand) calls `drive_sync.upload_shared` into `notes/<student-name>/`.

`brain.build_index` gains an additional pass: pull every classmate's shared
note from Drive, normalize it the same way local self-notes already are
(existing `_normalize_study_book_summaries`-style pipeline), and index it
alongside the local corpus with an added `sharedBy: <student-name>` field
carried through to `brain_query` results. Attribution is not stripped —
Drive already tracks the uploader, so this is metadata that already exists,
just surfaced.

## F. Testprep sharing

Generating a testprep is unchanged — stays local under `study/`, never
auto-shared. A new explicit action (dashboard button or CLI subcommand)
uploads it via `drive_sync.upload_shared` into `testprep/<student-name>/`
and returns the Drive shareable link for the student to post/send however
they choose.

## G. In-dashboard chatbot

New job kind `"chat"` in `dashboard/server/src/lib/jobs.ts`'s existing
`JobKind` union (currently `sync | calendar-sync | ingest | transcribe |
transcribe-url | transcribe-inbox`), spawning `claude -p "<message>"` with a
scoped `--allowedTools` list (mirroring the daily/evening jobs' allowlist —
Bash for `lms_scrape.py`/`osascript`, `Write`/`Read` confined to the repo,
the `mcp__plugin_mesa_mesa__*` tools). Output streams through the **existing**
SSE job-log mechanism (`GET /api/jobs/:id/log`) — no new streaming
infrastructure. The web app gets a new chat panel (a text input + the
existing `JobLog` component) rather than a bespoke UI.

This makes every existing skill (`testprep`, `course-brief`, `ask`,
`assignment-help`, `book-summary`, `week-ahead`) reachable from the
dashboard with zero duplicated logic — the chat message _is_ the `/mesa:...`
command (or close enough that the skill's own argument parsing handles it).
Depends on gate item C.2's `claudeCliLoggedIn` check.

## Non-goals

- No hosted/multi-tenant service, no shared database, no per-student server
  accounts.
- No invite-code or cohort-membership system — Drive's own sharing is the
  membership mechanism.
- No real-time collaboration (no live cursors, no concurrent-edit merging)
  — shared files are write-once-then-read, not co-edited.
- No change to attendance, assignments, or grades handling — these stay
  exactly as local-only as they are today, by construction (the shared-data
  code paths never touch them).
- No anonymization layer for shared notes — attribution is a locked
  decision, not a future toggle.

## Build order

This spec covers six sub-systems with a real dependency order — not
independent enough to plan as one flat task list, but not fully separable
into standalone specs either, since C is a hard prerequisite for D/E/F/G.
Recommended order for the implementation plan(s):

1. **Auth foundation (C.1)** — `google_auth.py`, `calendar_sync.py`
   refactored onto it, `drive_sync.py`'s read/write-if-absent/upload
   primitives. Nothing downstream works without this.
2. **Onboarding gate (C.2)** — `setup_state.py`, the dashboard-server
   enforcement, the `SetupGate` web component. Blocks real dashboard use
   until done, so it comes right after the primitives exist to check.
3. **Shared-first sync (D)** — materials/transcripts/GUIDE.md wired onto
   `drive_sync`. The highest-value piece (removes the most duplicate work),
   depends only on 1.
4. **Notes sharing + index merge (E)** and **testprep sharing (F)** —
   independent of each other, both depend on 1; can be built in either order
   or in parallel.
5. **In-dashboard chatbot (G)** — depends on 2 (the `claudeCliLoggedIn`
   gate) but not on 3/4/5; could in principle be built in parallel with
   those once the gate exists.

Each numbered item is a reasonable candidate for its own implementation
plan (own task list, own review), rather than one plan covering all six.

## Open questions carried into planning

- Exact shape of the dashboard's "SPA renders setup-only" mechanism (a
  wrapper route vs. a real HTTP-layer gate on every API response) is left to
  the implementation plan to pin down against the current router structure.
- Whether `drive_sync.py`'s race-loser re-sync is pull-based (next scrape
  notices the hash mismatch) or needs an explicit "someone else already has
  this" check before uploading — left as an implementation choice, not a
  design requirement (both satisfy "no data loss, occasional wasted work").
- Multi-course Picker grants: does picking a folder for Course A also need
  re-picking for Course B, or can one grant somehow cover multiple folders?
  Treated as "no" (must re-pick per course) unless the plan's spike on the
  Picker API says otherwise.
