# E — daily 6 AM job + morning digest

**Date:** 2026-09-04
**Status:** Approved
**Scope:** Objective 10. A launchd job runs headless Claude Code at 06:00 that
scrapes, syncs the calendar, and writes a morning digest (`daily/<date>.md`) with a
macOS notification. Plus the deterministic data layer the digest is built from.

## Locked decisions (from the 2026-09-01 foundation brainstorm, still binding)

- launchd runs `claude -p "/course-daily"` at 06:00 local. Digest = `daily/<date>.md`
  - `osascript` notification.
- Python sidecar does the deterministic work; the skill does synthesis. MCP tools
  never call an LLM.
- `daily/` is gitignored (already).
- Transcription is NOT in the daily run (too slow — ~19 min/recording). Manual via
  `/course-ingest` only. `lms_scrape.py all` already excludes it.

## Decisions (this sub-project)

| Question              | Decision                                                                                                                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Digest sections       | (1) Today's classes + pre-reads, (2) assignments due within 72h, (3) what changed since the last scrape, (4) a mindset line grounded in the actual day.                                      |
| Digest generation     | `launchd → claude -p "/course-daily"`. The skill runs the deterministic steps then synthesizes the prose.                                                                                    |
| Notification          | One-line summary (`3 classes · 1 due tomorrow · 2 new announcements`); clicking opens the digest file.                                                                                       |
| Headless permissions  | The plist passes a scoped `--allowedTools` allowlist — the job cannot act outside it. No `--dangerously-skip-permissions`.                                                                   |
| launchd install       | A `/daily-setup` command writes + loads the plist; `/daily-uninstall` unloads + removes it.                                                                                                  |
| "What changed" source | Derived from existing state — normalized docs whose frontmatter `updatedAt` is within `--changed-since-hours` (default 26). No new state file. First-ever run flags everything (documented). |

## Architecture

```
launchd (06:00)
  └─ claude -p "/course-daily"  --allowedTools <scoped>  (cwd = repo root)
       skill course-daily:
         1. Bash: lms_scrape.py all         → scrape + ingest + brain-index
              (on non-zero exit: note it, keep going with existing data)
         2. Bash: lms_scrape.py calendar-sync
         3. tool daily_brief                → structured JSON
         4. Write daily/<YYYY-MM-DD>.md     → 4 sections, synthesized
         5. Bash: osascript -e 'display notification …'
```

### `scraper/daily_brief.py` (new — pure, no LMS auth)

Module-top imports: stdlib + `from paths import ...` + `import brain`. (`brain` is
already import-isolation-clean — stdlib + yaml + paths. Do NOT import `scrape_steps`
or `mesa_api`.)

`build_daily_brief(now=None, *, within_hours=72, changed_since_hours=26) -> dict`:

```
{
  "date": "2026-09-04",              # local date
  "generatedAt": "2026-09-04T00:31:00Z",
  "classesToday": [
    { "start": "2026-09-04T14:00:00+05:30", "end": "...", "course": "AI and its Application",
      "courseSlug": "ai-and-its-application", "room": "Delta Classroom",
      "instructor": "Divij Bajaj", "meetingLink": null,
      "prereadPaths": ["normalized/material-….md", ...] }      # from brain.next_session when its startAt is today
  ],
  "assignmentsDue": [
    { "title": "...", "course": "...", "dueAt": "...", "hoursAway": 39.5,
      "submitted": false, "isClub": false, "submissionType": "file" }
  ],
  "changed": {                        # normalized docs with updatedAt within the window
    "ai-and-its-application": { "material": 2, "announcement": 1 },
    ...
  },
  "changedSinceHours": 26,
  "scrapeStale": false               # true if courses/_events.json mtime > 26h old
}
```

- **classesToday:** read `courses/_events.json` `events[]`. Keep `eventType == "session"`
  whose `startAt` parsed to the machine's local tz falls on today's local date. Sort by
  start. For each distinct `courseSlug`, call `brain.next_session(slug)`; if its result is
  non-None and its `startAt` local date == today, attach `prereadPaths`. Missing `courseSlug`
  → still list the class, `prereadPaths: []`.
- **assignmentsDue:** iterate `courses/<slug>/raw/assignments.json` + `courses/_assignments-unassigned.json`
  (same sources `calendar_sync._iter_assignments` uses — but `daily_brief` reads them directly,
  it does NOT import `calendar_sync`). Keep items with a parseable `dueAt` in
  `(now, now + within_hours]`. `hoursAway` rounded to 0.1. `submitted` = `mySubmissionStatus == "submitted"`.
- **changed:** walk `courses/*/normalized/*.md` (skip `_*`), parse frontmatter, keep those with
  `updatedAt` (ISO) `> now - changed_since_hours`. Group `{slug: {type: count}}`. Uses
  `brain.parse_frontmatter`.
- **scrapeStale:** `courses/_events.json` mtime older than `changed_since_hours` → the morning
  scrape probably failed; the skill shows a banner.
- Never raises for one bad course/file — per-item try/except, skip and continue.

### CLI — `scraper/lms_scrape.py`

`daily-brief [--json] [--within-hours N] [--changed-since-hours N]` → prints
`build_daily_brief(...)`. Reads disk only, no auth. Same dispatch pattern as `brain-*`.

### MCP tool — `mcp/src/tools/daily_brief.ts`

`daily_brief({ withinHours?, changedSinceHours? })` → spawns
`lms_scrape.py daily-brief --json [...]`. Returns `{ ok, brief } | { ok:false, error }`.
Registered in `mcp/src/index.ts` `tools`. No LLM. Follows `brain_get.ts` shape.

### Skill — `skills/course-daily/SKILL.md` + `commands/course-daily.md`

Steps, in order, each tolerant of the previous failing:

1. `Bash`: `cd scraper && uv run python lms_scrape.py all --json` (from repo root, no
   `COURSE_AGENT_HOME` — inherits the default). Capture the JSON. Non-zero exit or an
   `errors` array → remember it for the digest's top banner; **do not abort**.
2. `Bash`: `cd scraper && uv run python lms_scrape.py calendar-sync --json`. Same tolerance.
3. Tool `daily_brief`.
4. `Write` `daily/<YYYY-MM-DD>.md` (local date). Structure:
   - `# <date> — morning brief`
   - a `> SCRAPE FAILED …` blockquote **only if** step 1/2 failed or `brief.scrapeStale` —
     tell the user to run `cd scraper && uv run python lms_scrape.py all` by hand / paste a
     fresh `MESA_REFRESH_TOKEN` if it's an auth error.
   - `## Today's classes` — per class: `**HH:MM–HH:MM** Course — Room (Instructor)`, then
     pre-reads as a nested bullet list of titles linking the normalized paths, or
     `_no pre-reads found_`.
   - `## Due soon` — per assignment: `- [ ] **Title** — Course — due <relative> (<abs IST>)`,
     `[submitted]` tag when done; `_nothing due in 72h_` when empty.
   - `## What changed` — per course with changes: `- Course: 2 materials, 1 announcement`;
     `_nothing new_` when empty; if `brief` has no manifest data at all, `_first run —
baseline recorded_`.
   - `## Mindset` — 2–4 sentences. Grounded in THIS day's data: class load, whether an exam
     is within a week (`brief` + calendar), nearest deadline. No generic filler. Calm,
     specific (the user's "Power of Communication" / thoughtful-not-hype register).
5. `Bash`: `osascript -e 'display notification "<summary>" with title "Mesa — morning brief"'`
   where `<summary>` = `N classes · M due soon · K changes` (say `scrape failed` first if so).

The skill does its own date math for the filename (local date). It reads normalized
titles via `Read` on the paths `daily_brief` returns.

### Commands — `/daily-setup`, `/daily-uninstall`

`commands/daily-setup.md`: instruct Claude to

- resolve the repo root (`git rev-parse --show-toplevel`) and the `claude` binary path (`which claude`);
- write `~/Library/LaunchAgents/co.mesa.course-agent.daily.plist` from the template below,
  substituting `<REPO>` and `<CLAUDE>`;
- `launchctl unload` (ignore error) then `launchctl load` it;
- print the plist path, the schedule, and how to check logs (`daily/_launchd.log`).

Plist template:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>co.mesa.course-agent.daily</string>
  <key>WorkingDirectory</key><string><REPO></string>
  <key>ProgramArguments</key><array>
    <string><CLAUDE></string>
    <string>-p</string><string>/course-daily</string>
    <string>--allowedTools</string>
    <string>Bash(cd:*),Bash(uv run python lms_scrape.py:*),Bash(osascript:*),Write(daily/**),Read(courses/**),mcp__mesa-course-agent__daily_brief,mcp__mesa-course-agent__calendar_sync,mcp__mesa-course-agent__scrape,mcp__mesa-course-agent__ingest</string>
  </array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>6</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string><REPO>/daily/_launchd.log</string>
  <key>StandardErrorPath</key><string><REPO>/daily/_launchd.log</string>
  <key>RunAtLoad</key><false/>
</dict></plist>
```

`commands/daily-uninstall.md`: `launchctl unload ~/Library/LaunchAgents/co.mesa.course-agent.daily.plist` then `rm` it.

> The exact `--allowedTools` string is validated in the live run — if `claude -p` still
> prompts, widen it minimally and record the final value in `docs/lms-api.md`.

## Non-goals

- No web dashboard, no email. File + notification only.
- No ret/backfill of missed days. If the Mac is asleep at 06:00, launchd runs it at wake
  (default behaviour); a missed day is just skipped.
- The mindset line is not therapy or advice — it's a framing sentence.

## Testing

- `daily_brief.build_daily_brief` — fixture corpus with: a session today (+ a matching
  `next_session` pre-read), a session tomorrow (excluded from `classesToday`), an assignment
  due in 40h (included) / in 200h (excluded) / already submitted (included, flagged), a
  normalized doc with a fresh `updatedAt` (counted) and a stale one (not). Assert every
  block. `scrapeStale` true when `_events.json` mtime is backdated.
- One bad course dir (no `assignments.json`, malformed frontmatter) → still returns, other
  courses intact.
- CLI `daily-brief --json` → parses, has the keys.
- MCP `daily_brief` tool — temp `COURSE_AGENT_HOME`, stub spawn, assert argv + parse (mirror
  `brain_get.test.ts`).
- Skill + commands: no unit test (Claude-executed). Live run is the check.
- Import isolation: a `test_daily_brief_import_isolation` mirroring the calendar/brain ones —
  importing `daily_brief` must not pull `mesa_api` / `scrape_steps` / `dotenv` / `requests`.

## Live run

1. `cd scraper && uv run python lms_scrape.py daily-brief --json | python3 -m json.tool` —
   eyeball today's classes, due list, changed counts.
2. `/course-daily` interactively once — confirm `daily/<today>.md` is written with all four
   sections and a grounded mindset line, and the notification fires.
3. `/daily-setup`, then `launchctl start co.mesa.course-agent.daily` to force a run now;
   check `daily/_launchd.log` for permission prompts; confirm a fresh digest + notification.
4. Record the working `--allowedTools` string and any launchd quirks in `docs/lms-api.md`.

## Build order

1. `daily_brief.py` + CLI + import-isolation test.
2. `daily_brief` MCP tool + registration.
3. `course-daily` skill + `/course-daily` command.
4. `/daily-setup` + `/daily-uninstall` commands + plist template.
5. Live run + `docs/lms-api.md` + README "Daily job" section.

Subagent-driven, TDD.
