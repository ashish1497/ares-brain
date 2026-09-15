# Ares Brain

A Claude Code and Codex **plugin** that turns Mesa LMS ("Nexus") coursework into a study agent:
scrape every course onto disk, normalize it, build a per-course searchable "brain",
sync deadlines + the class schedule to Google Calendar, and produce briefings,
assignment help, test-prep, book summaries, and a daily morning digest.

All work is local. A Python sidecar (`scraper/`) does the deterministic work; a
TypeScript MCP server (`mcp/`) exposes it to Claude Code as tools; Claude Code skills
orchestrate the tools and do the writing. **No MCP tool ever calls an LLM.**

---

## Feature sets

**Corpus** — scrape every Mesa course (materials, assignments, announcements,
attendance, class recordings) onto disk; transcribe recordings; normalize everything
into searchable markdown with a content-hash manifest so re-runs only touch what
changed.

**Course brain** — a per-course SQLite FTS index plus a synthesized `GUIDE.md`
(concepts, frameworks, how sessions connect), rebuilt on demand as new material lands.

**Briefings & planning** — pre-class briefings, a 7-day week-ahead view across every
course, and a daily 6 AM morning digest + 6 PM evening check (via a launchd job),
each written to `daily/<date>.md`.

**Study tools** — cited Q&A over the corpus (`ask`), an assignment-help skeleton
(never a submittable draft), book summaries with a gap-check against what's actually
mentioned in class, generic testprep sets, and mock mid-terms that match the _real_
declared exam format per course (`config/midterm-exam-format.md`) rather than guessing.

**Calendar** — one-time OAuth, then deadlines + the class schedule sync to a
dedicated "Mesa Assignments" Google Calendar, reminders included.

**Cohort Drive sharing** — register a shared Drive folder per course; materials,
transcripts, and the guide auto-push there (once a folder exists); notes and testprep
sets are opt-in only. A sync checklist shows what's registered and what's still only
local, with a one-click backfill for courses that had content before their folder
existed.

**Dashboard** — a local, no-auth, read-only web app (`npm run dashboard`) answering
"where do I stand, what needs me next": Today, Assignments, Attendance, Exams, Brain,
Gaps, Chat, Drive, and Testprep tabs. See [Dashboard](#dashboard) below.

**Outreach agent** — a separate dashboard page (`dashboard/server/src/lib/outreach*`)
for B2B outreach research — ICP definition, industry/company/people research, and
draft message generation with a verify step. Unrelated to coursework; a distinct tool
mounted in the same dashboard shell.

---

## Prerequisites

- macOS (the calendar OAuth and daily-job pieces are macOS-flavoured; scrape / ingest /
  brain work anywhere).
- [`uv`](https://docs.astral.sh/uv/) for the Python 3.12 sidecar venv.
- Node 18+ for the MCP server.
- Claude Code (desktop app or CLI) with an active Claude subscription.
- A Mesa student account.

---

## Install

### Codex

This repo now includes the portable Codex manifest (`.codex-plugin/plugin.json`) and MCP
configuration (`.mcp.json`). From the repository root:

```bash
export ARES_BRAIN_HOME="$PWD"
codex plugin marketplace add .
codex plugin add mesa@mesa-local
```

Start a new Codex thread after installation. Skills are invoked as `$ares-brain-ask`,
`$ares-brain-course-daily`, `$ares-brain-assignment-help`, and so on. The same local `courses/`
corpus and MCP tools are used by Claude and Codex; no second scrape or database is created.
Keep `ARES_BRAIN_HOME` set in the shell that launches Codex so cached plugin code still points at
this checkout's corpus and `scraper/.venv`.

Codex support is intentionally additive: the existing Claude marketplace and `/mesa:*` commands
remain unchanged.

### 1. Python sidecar

```bash
cd scraper
uv venv --python 3.12 .venv
uv pip install -r requirements.txt
```

Pulls `faster-whisper` + `yt-dlp` (transcription) and the Google API client libraries
(calendar).

### 2. MCP server

```bash
npm install                        # at the repo root (npm workspace)
npm run --workspace mcp build      # produces mcp/dist/index.js — the plugin launches this
```

`mcp/dist/` is gitignored — **rebuild after every pull.**

### 3. LMS token

```bash
cp .env.example .env
```

Paste a fresh `refresh_token` cookie into `.env` as `MESA_REFRESH_TOKEN`:
DevTools → Application → Cookies → `students.mesaschool.co.in` → `refresh_token`.
The scraper rotates and rewrites this value on every run, so it stays valid for ~30
days of use; if it ever locks out, paste a new one.

### 4. Install the plugin

The repo ships a local marketplace manifest (`.claude-plugin/marketplace.json`).

**From an interactive Claude Code terminal:**

```
/plugin marketplace add /absolute/path/to/ares-brain
/plugin install mesa@mesa-local
```

**From a plain shell (works everywhere, incl. the desktop app where `/plugin` is
unavailable):**

```bash
cd /absolute/path/to           # the PARENT of ares-brain
claude plugin marketplace add ./ares-brain
claude plugin install mesa@mesa-local
claude plugin list             # confirm it's enabled
```

Restart Claude Code. Skills then appear as `/mesa:<name>` and MCP tools
as `mcp__plugin_mesa_mesa__<tool>`.

### Updating the plugin after a repo change

The install is a **cache copy**, not a live link. After pulling or editing:

```bash
cd mcp && npm run build && cd ..
claude plugin uninstall mesa@mesa-local
claude plugin marketplace update mesa-local
claude plugin install mesa@mesa-local
```

---

## Quickstart prompt

Finished the four install steps above? Open a Claude Code session in this repo and
paste this as your first message — it walks you through everything else, explains
each step as it goes, and stops to ask before anything irreversible:

```
I just set up ares-brain for my Mesa cohort and this is my first time using it.

1. Run `cd scraper && uv run python lms_scrape.py setup-state --json` and tell me
   plainly what's missing (Drive/Calendar OAuth, my LMS token, Claude CLI login).
2. Help me fix whatever's missing, one thing at a time — tell me exactly what to do
   for anything that needs my own browser/account action.
3. Once setup is clean, run /mesa:ares-brain-course-scrape to pull my courses.
4. Build the knowledge brain for my two or three heaviest courses with
   /mesa:ares-brain-course-brain.
5. Give me a /mesa:ares-brain-week-ahead so I know what's coming up.
6. Tell me, in a few sentences, what I should ask you for day-to-day (briefings,
   testprep, assignment help) and what the dashboard (`npm run dashboard`) is for.

Explain what each step does before you run it — I'm new to this, not just to this repo.
```

If your cohort already shares a `config/course-drive-folders.json` (ask whoever set
this up first), pull that before step 3 so your scrape lands in the shared Drive
folders your classmates can already see — see **Drive** under Dashboard tabs below.

---

## Commands

| Command                                                             | What it does                                                                                                                                                                                 |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/mesa:ares-brain-course-scrape [slug]`                             | Pull latest data for every course (or one). Runs scrape → ingest → brain-index. **Not** transcription.                                                                                       |
| `/mesa:ares-brain-course-ingest [slug]`                             | Transcribe class recordings, then normalize all `raw/` + `inbox/` material into `normalized/*.md`.                                                                                           |
| `/mesa:ares-brain-course-brain <slug>`                              | Build/refresh `GUIDE.md` — a concept + framework + session-arc overview of one course.                                                                                                       |
| `/mesa:ares-brain-course-brief <slug>`                              | Briefing for that course's next session: topic, what to read, questions to hold.                                                                                                             |
| `/mesa:ares-brain-week-ahead`                                       | Every class + exam in the next 7 days, with the one thing to read for each.                                                                                                                  |
| `/mesa:ares-brain-ask <slug> "question"`                            | Cited answer from the course corpus. Ephemeral, nothing written. Says "not in the material" rather than guessing.                                                                            |
| `/mesa:ares-brain-assignment-help <slug> "<assignment>"`            | Approach + a worked skeleton (not a submittable draft). Refuses if already submitted.                                                                                                        |
| `/mesa:ares-brain-testprep <slug> [N-M]`                            | ~15 graded practice questions with collapsible model answers, optionally session-scoped. Saved to `study/`.                                                                                  |
| `/mesa:ares-brain-mock-midterm <slug>`                              | Mock mid-term matching the _real_ declared exam format (marks, timing, question types) from `config/midterm-exam-format.md` — refuses if that course has no written exam. Saved to `study/`. |
| `/mesa:ares-brain-book-summary [slug]`                              | Summarize each uploaded book; flag books mentioned in class but missing. Summaries become searchable on the next ingest.                                                                     |
| `/mesa:ares-brain-calendar-sync`                                    | Sync deadlines + class schedule to the "Mesa Assignments" Google Calendar.                                                                                                                   |
| `/mesa:ares-brain-course-daily`                                     | The morning routine: scrape → calendar-sync → write `daily/<date>.md` → notify.                                                                                                              |
| `/mesa:ares-brain-daily-setup` · `/mesa:ares-brain-daily-uninstall` | Install / remove the 6 AM launchd job that runs `/mesa:ares-brain-course-daily`.                                                                                                             |

Ask Claude Code to "run the status tool" for config, token expiry, sidecar health,
per-course file counts, and last scrape/ingest times.

---

## Data layout

```
courses/
  _index.json  _events.json  _attendance.json  _announcements.json  _assignments-unassigned.json  _calendar.json
  <slug>/
    raw/          scraped API payloads + downloaded files
    inbox/        YOUR drops: notes/, books/, recordings/
    transcripts/  whisper output, [hh:mm:ss] lines
    normalized/   normalized/*.md  +  _ingest.json (content-hash manifest)
    brain/        index.sqlite  GUIDE.md  course.md  _brain.json
    study/        /mesa:ares-brain-assignment-help, /mesa:ares-brain-testprep, /mesa:ares-brain-mock-midterm, /mesa:ares-brain-book-summary artifacts
daily/            daily/<date>.md  +  _launchd.log
config/
  course-drive-folders.json   slug -> cohort Drive folder id (commit + push so your
                               cohort sees new registrations — the only piece of this
                               repo's own git history meant to carry course-specific data)
  midterm-exam-format.md      hand-captured real exam format per course (marks, timing,
                               question types) — exam formats usually go out by email,
                               not through the LMS, so this can't be scraped; update it
                               by hand each term
```

Everything under `courses/` and `daily/` is gitignored. `course.md` is your own focus
notes — created blank once, never overwritten, loaded as context on every course
question.

---

## Calendar (one-time OAuth)

gcloud ADC does **not** work for the Calendar scope — you need your own Desktop OAuth
client.

1. Google Cloud Console → new project → enable **Google Calendar API**.
2. OAuth consent screen: **External**, publishing status **Testing**, add your Google
   account under **Test users**.
3. Credentials → Create Credentials → OAuth client ID → **Application type: Desktop app**
   → download JSON → save as `client_secret.json` at the repo root (gitignored).
4. `cd scraper && uv run python lms_scrape.py calendar-auth` — browser consent, once.
   `token.json` is cached (gitignored).

Then `/mesa:ares-brain-calendar-sync` runs headlessly. Re-run `calendar-auth` if the token is revoked
or expires beyond refresh. `GOOGLE_CLIENT_SECRET` / `GOOGLE_TOKEN` env vars override
the paths.

Reminder tuning: `CALENDAR_REMINDERS` (minutes, default `1440,120`) for deadlines;
`CALENDAR_SESSION_REMINDERS` for class sessions (unset = same as `CALENDAR_REMINDERS`;
empty = none; `15` = one 15-min popup).

---

## Daily job (6 AM)

`/mesa:ares-brain-daily-setup` writes `~/Library/LaunchAgents/co.mesa.ares-brain.daily.plist` — it
runs `claude -p /mesa:ares-brain-course-daily` at 06:00 local with a scoped
`--allowedTools` allowlist, logging to `daily/_launchd.log`.

**The launchd job runs the `claude` binary on your `PATH`, which is a separate install
from the desktop app and is not logged in by default.** Authenticate it once, in
Terminal:

```bash
claude setup-token          # long-lived token for automation; needs the subscription
```

Then trigger a test run and check the log:

```bash
launchctl kickstart -k gui/$(id -u)/co.mesa.ares-brain.daily
cat daily/_launchd.log
```

If the log shows a tool-permission prompt, widen `--allowedTools` in the plist and
`launchctl bootout` / `bootstrap` it again. `/mesa:ares-brain-daily-uninstall` removes the job.

Transcription is never part of the daily run (too slow) — run `/mesa:ares-brain-course-ingest` by hand.

---

## Dashboard

A local, read-only outcome dashboard over the scraped course data — a full-width
tabbed app, not a report. It answers "where do I stand, and what needs me next?" —
the landing view is **Today**.

```bash
npm run dashboard          # dev — Vite on :5173 proxying the API on :4319
npm run dashboard:build    # then: npm run --workspace ares-dashboard-server start  (serves :4319)
```

Or `/mesa:ares-brain-dashboard` from Claude Code. The server binds `127.0.0.1` only
and has no auth.

**The tabs**

| Tab             | Answers                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Today**       | what needs you in the next 24–48h: today's classes, what's due, what changed since the last sync.                                                                                                                                                                                                                                                                                                                  |
| **Assignments** | everything unsubmitted, risk-ordered, plus the grade picture. Click a row for a focused page with the deadline, the scraped instructions, attached materials, the session it maps to, a copy-command to start it in Claude, and a local checklist.                                                                                                                                                                 |
| **Attendance**  | every course against the attendance minimum, with best-case and floor projections.                                                                                                                                                                                                                                                                                                                                 |
| **Exams**       | what is scheduled, what it covers, whether the brain and a practice set are ready.                                                                                                                                                                                                                                                                                                                                 |
| **Brain**       | per-course knowledge guides and what is blocking each.                                                                                                                                                                                                                                                                                                                                                             |
| **Gaps**        | what the system is missing: untranscribed recordings, missing books, a stale scrape.                                                                                                                                                                                                                                                                                                                               |
| **Chat**        | freeform Q&A over the corpus — runs `claude -p` server-side per message, streams the reply. No fixed command list; ask anything.                                                                                                                                                                                                                                                                                   |
| **Drive**       | connect each course to a shared cohort Drive folder (Picker or paste a folder ID/URL), see what's auto-synced (materials/transcripts/guide) vs. opt-in shared (notes/testprep), and a **Sync checklist** across all courses — registered?, how many local files are share-eligible, one-click Push per course (needed once per course: registering a folder doesn't retroactively push what was already ingested). |
| **Testprep**    | read testprep/mock-midterm sets in-browser (collapsible model answers) and self-grade — scores stay in `localStorage` only, never written into the shared file. Two generate buttons: **Testprep** (generic practice mix) and **Mock midterm** (matches the real exam format, per `config/midterm-exam-format.md`).                                                                                                |

**Deterministic jobs vs copy-command.** The dashboard splits work two ways.
Deterministic jobs — `sync`, `ingest`, `transcribe`, `calendar-sync` — run on the
server, kicked off from the Re-sync button, a per-row job button, or (for
`calendar-sync`) the Settings panel's Sync calendar button, and stream their
log into the strip at the bottom right. Anything that needs judgement — `Start in
Claude`, `Practice set`, `Brief me`, `Build guide` — is a yellow copy button that
hands you the exact `/mesa:ares-brain-*` command to paste into a Claude Code session.
The dashboard itself makes **no LLM calls** and never writes back to the LMS; the
assignment checklist and the focused page's local status control live in
`localStorage` only and are advisory.

**Themes.** A Settings panel (gear, top right) offers two themes — `Meadow` (green)
and `Ultraviolet` (violet/cream) — each crossed with `System` / `Light` / `Dark`.
The choice persists in `localStorage` (`ares.theme`, `ares.appearance`) and is applied
to `<html>` via `data-theme` / `data-appearance`; a small inline script in
`index.html` sets both before first paint, so there's no flash. The same panel lists
the env vars below, read-only.

**Refresh.** The **⟲ Re-sync** button in the summary bar, or press **`r`** when no
input is focused.

Env: `ARES_BRAIN_ATTENDANCE_MIN` (default 75), `ARES_BRAIN_CHAT_UNLOCK` (default 15),
`ARES_BRAIN_DASHBOARD_PORT` (default 4319).

---

## Deployment

This is a local, single-user agent. For running it on a schedule, a second machine, or
a headless box, see [`docs/DEPLOY.md`](docs/DEPLOY.md).

---

## Lint, format & test

The repo is an npm workspace (root `package.json`) owning the JS tooling; `scraper/`
is Python.

```bash
npm install                # once, at the repo root — also wires the pre-commit hook

npm run format             # prettier --write across the repo
npm run format:check       # prettier --check (what CI runs)
npm run lint               # eslint (mcp/ TypeScript)
npm run check              # format:check + lint + mcp tsc + mcp vitest + dashboard web tsc + dashboard build

cd mcp && npm test          # vitest
cd scraper && uv run pytest # ~190 tests
```

A **pre-commit hook** (husky + lint-staged) auto-runs `eslint --fix` + `prettier` on
staged `mcp/` and `dashboard/` TS and `prettier` on staged `*.md` / `*.json` / `*.yaml`. Test fixtures
under `scraper/tests/fixtures/` are prettier-ignored (they're byte-asserted by tests).

**CI** (`.github/workflows/ci.yml`) runs four jobs on push/PR: `format:check`,
`mcp` lint+build+test, `dashboard` build+typecheck+test, `scraper` pytest.

---

Design docs: `docs/superpowers/specs/` and `docs/superpowers/plans/`.
LMS API reference and live-run notes: `docs/lms-api.md`.
