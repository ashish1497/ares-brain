# Ares Brain

A Claude Code **plugin** that turns Mesa LMS ("Nexus") coursework into a study agent:
scrape every course onto disk, normalize it, build a per-course searchable "brain",
sync deadlines + the class schedule to Google Calendar, and produce briefings,
assignment help, test-prep, book summaries, and a daily morning digest.

All work is local. A Python sidecar (`scraper/`) does the deterministic work; a
TypeScript MCP server (`mcp/`) exposes it to Claude Code as tools; Claude Code skills
orchestrate the tools and do the writing. **No MCP tool ever calls an LLM.**

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

## Commands

| Command                                                             | What it does                                                                                                             |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `/mesa:ares-brain-course-scrape [slug]`                             | Pull latest data for every course (or one). Runs scrape → ingest → brain-index. **Not** transcription.                   |
| `/mesa:ares-brain-course-ingest [slug]`                             | Transcribe class recordings, then normalize all `raw/` + `inbox/` material into `normalized/*.md`.                       |
| `/mesa:ares-brain-course-brain <slug>`                              | Build/refresh `GUIDE.md` — a concept + framework + session-arc overview of one course.                                   |
| `/mesa:ares-brain-course-brief <slug>`                              | Briefing for that course's next session: topic, what to read, questions to hold.                                         |
| `/mesa:ares-brain-week-ahead`                                       | Every class + exam in the next 7 days, with the one thing to read for each.                                              |
| `/mesa:ares-brain-ask <slug> "question"`                            | Cited answer from the course corpus. Ephemeral, nothing written. Says "not in the material" rather than guessing.        |
| `/mesa:ares-brain-assignment-help <slug> "<assignment>"`            | Approach + a worked skeleton (not a submittable draft). Refuses if already submitted.                                    |
| `/mesa:ares-brain-testprep <slug> [N-M]`                            | ~15 graded practice questions with collapsible model answers, optionally session-scoped. Saved to `study/`.              |
| `/mesa:ares-brain-book-summary [slug]`                              | Summarize each uploaded book; flag books mentioned in class but missing. Summaries become searchable on the next ingest. |
| `/mesa:ares-brain-calendar-sync`                                    | Sync deadlines + class schedule to the "Mesa Assignments" Google Calendar.                                               |
| `/mesa:ares-brain-course-daily`                                     | The morning routine: scrape → calendar-sync → write `daily/<date>.md` → notify.                                          |
| `/mesa:ares-brain-daily-setup` · `/mesa:ares-brain-daily-uninstall` | Install / remove the 6 AM launchd job that runs `/mesa:ares-brain-course-daily`.                                         |

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
    study/        /mesa:ares-brain-assignment-help, /mesa:ares-brain-testprep, /mesa:ares-brain-book-summary artifacts
daily/            daily/<date>.md  +  _launchd.log
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

A localhost web UI — one scrolling page that answers "where do I stand?" for the term.
Not another LMS view: every section is derived from the scraped data and points at the
next action.

```bash
npm run dashboard          # dev — Vite on :5173 proxying the API on :4319
npm run dashboard:build    # then: npm run --workspace ares-dashboard start  (serves :4319)
```

Or `/mesa:ares-brain-dashboard` from Claude Code. Binds `127.0.0.1` only, no auth. One
long job at a time. React + Vite, neubrutalist styling, follows the OS light/dark theme.

**The sections**

| Section                     | Answers                                                                                                                                                                                                                                                                                                           |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| KPI strip                   | due this week, next exam, CP average, attendance now → best case, brains ready. Tiles turn amber when a number needs attention.                                                                                                                                                                                   |
| Today                       | classes with times/room/instructor, what's due today or tomorrow, what changed in the LMS since the last scrape.                                                                                                                                                                                                  |
| This week                   | the next 7 days grouped by day — classes, assignment due dates, exams.                                                                                                                                                                                                                                            |
| Assignments — by grade risk | every unsubmitted task, ordered by weight × urgency, each with its grade weight and a **Start** command. Below: per-course "% of grade still ahead".                                                                                                                                                              |
| Exam prep                   | each exam, days out, whether its course brain is ready, whether a practice set exists.                                                                                                                                                                                                                            |
| Attendance runway           | per course: attendance now, sessions left, best-case % to midterm / endterm, and a three-state flag — **on track** / **watch** (at the line, or one miss from it once ≥ 4 sessions held) / **at risk** (even perfect attendance can't recover 75%). Threshold is an assumption — set `ARES_BRAIN_ATTENDANCE_MIN`. |
| Where you stand             | per course brain: ready / stale / not-built, why, and **Ingest** / **Build brain**.                                                                                                                                                                                                                               |
| Needs your input            | recordings still to transcribe (**Transcribe all** pulls the scraped YouTube links), books mentioned in outlines but not added (drop the PDF right here), stale scrape (**Sync**).                                                                                                                                |
| Chat                        | locked until `ARES_BRAIN_CHAT_UNLOCK` (default 15) course brains are ready — phase 2.                                                                                                                                                                                                                             |

**Deterministic vs copy-command.** Buttons that do a bounded job — Sync, Ingest,
Transcribe, upload — run it directly and stream the log. Anything that needs a
Claude session — assignment help, `course-brain`, `testprep` — hands you the exact
`/mesa:ares-brain-*` command to paste. The dashboard never drives Claude itself.

Env: `ARES_BRAIN_DASHBOARD_PORT` (4319), `ARES_BRAIN_ATTENDANCE_MIN` (75),
`ARES_BRAIN_CHAT_UNLOCK` (15).

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
