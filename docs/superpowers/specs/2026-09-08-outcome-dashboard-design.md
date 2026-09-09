# G — Outcome dashboard (redesign of F)

**Date:** 2026-09-08
**Status:** Approved
**Scope:** Replace the F dashboard's course-picker + 4-action-card layout with a single
outcome-driven view: "exactly where do I stand, what do I do next, am I on track to
score well." Keeps the F server + job runner + `api.ts`; adds one `/api/overview` route
backed by a new `scraper/overview.py`. Rebuilds `dashboard/web` on React + shadcn/ui
(neobrutalism.dev registry). **Chatbot stays phase 2** — but its readiness gate is
designed here.

---

## 1. Why

The F dashboard is a passive action launcher — pick a course, click a button. It does
not answer the questions a Mesa PGP (startup leadership) student actually has: what's
due and how much is it worth, am I behind on any brain, which recordings/books are
missing, what's my attendance runway, is the chatbot even useful yet. The agent already
knows all of this from the scrape — it should say it, ranked by what protects the grade.

## 2. Locked decisions

| Question               | Decision                                                                                                                                                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Layout                 | One scrolling view, no course dropdown. Sections in grade-risk priority order (below).                                                                                                                                                                                                                       |
| Backend                | New `scraper/overview.py` (pure, mirrors `daily_brief.py`) → CLI `overview --json` → dashboard server `GET /api/overview`. Reuses `brain.py`, `daily_brief` helpers, outline parsing.                                                                                                                        |
| Design system          | Vite + **React 18** + shadcn/ui, components from the **neobrutalism.dev** registry, Tailwind v4. `dashboard/web` migrates Preact→React (7 tiny files, the redesign rewrites them anyway). Server + `api.ts` untouched.                                                                                       |
| Palette                | **B** — green edge `#0f8a5f`, mint paper `#eafff4` / white cards, coral accent `#ff8a3d`, yellow CTA `#ffd23f`. Status fills: green ok / amber soon-or-stale / red not-started-or-not-built. 3px borders, `4px 4px 0` hard shadow, 2px radius, no gradients. Dark mode: edge stays green, paper → `#161d1a`. |
| Runnable actions       | Only the deterministic jobs run from the dashboard via the existing job runner: **Sync** (`all`), **Ingest**, **Transcribe** (`transcribe --inbox` / `transcribe-url`), **Calendar sync** (`calendar-sync`).                                                                                                 |
| Claude-powered actions | `assignment-help`, `testprep`, `course-brain` need an LLM → **not run from phase-1 dashboard.** Each such button shows the deterministic data it can (instructions, weight, coverage) + a one-click-copy `/mesa:ares-brain-<cmd> …` string to paste in Claude Code. Phase 2 (chat) runs them in-app.         |
| Chatbot gate           | Chat panel locked until `brainReady >= threshold` (default 15 of the term's courses). Shows the count + progress bar. Threshold = `ARES_BRAIN_CHAT_UNLOCK` env, default 15.                                                                                                                                  |
| Attendance policy      | Requirement threshold is a tunable `ARES_BRAIN_ATTENDANCE_MIN` (default 75). Mesa's exact policy is unconfirmed — the number is displayed as "assumed ≥75%".                                                                                                                                                 |

## 3. `/api/overview` data model

`overview.py build_overview(now=None) -> dict`:

```jsonc
{
  "generatedAt": "2026-09-08T09:00:00Z",
  "date": "2026-09-08",
  "scrapeAgeHours": 2.1,
  "term": "Term 1",

  "kpis": {
    "dueThisWeek": 3,
    "nextExamInDays": 6,
    "nextExamName": "Mid Term Exams",
    "cpAvg": 7.2,                 // mean avgCp across courses; null if all 0
    "attendanceNow": 91,          // overall attended/conducted %
    "attendanceBestCase": 94,     // overall, attend everything to end-term
    "brainReady": 12,
    "courseCount": 17
  },

  "today": {                      // from daily_brief
    "classes": [ { "start","end","course","courseSlug","room","instructor",
                   "prereadPaths":[...], "prereadRead": false } ],
    "dueTodayOrTomorrow": [ { "title","course","dueAt","weightPct","submitted" } ],
    "changed": { "<slug>": {"material":2,"announcement":1} }
  },

  "thisWeek": [                   // next 7 days, sorted by datetime
    { "when":"2026-09-11", "kind":"assignment"|"exam"|"class",
      "title","course","courseSlug",
      "weightPct": 30,            // assignment only
      "status":"not-started"|"draft"|"submitted"|null,
      "coverage":"S1–S4",        // exam only
      "action": { "label":"Start", "type":"copy"|"job",
                  "value":"/mesa:ares-brain-assignment-help \"Power of Communication\" \"Pitch 1\"" } }
  ],

  "assignments": [               // ALL not-submitted, across courses, risk-desc
    { "id","title","course","courseSlug",
      "weightPct": 30,            // null if ungraded / unknown
      "dueAt":"2026-09-11T18:00:00Z", "hoursAway": 62.5,
      "status":"not-started"|"draft"|"submitted",
      "isClub": false, "submissionType":"file",
      "risk": 0.0..1.0,           // weightPct-scaled × urgency × not-started
      "helpCommand":"/mesa:ares-brain-assignment-help \"<course>\" \"<title>\"" }
  ],
  "gradePicture": [               // per course with a parsed assessment table
    { "course","courseSlug",
      "components":[ {"name":"Pitch 1","weightPct":30,"done":false},
                     {"name":"Classroom Participation","weightPct":10,"done":null} ],
      "aheadPct": 40,             // sum of weights not yet done
      "summary":"40% of grade still ahead: Pitch 1 (Sep 11), Pitch 2 (Sep 18)" }
  ],

  "exams": [
    { "name","date":"2026-09-19","inDays":11,
      "courses":["all"] | ["ai-and-its-application"],
      "coverageSessions":"S1–S4"|null,
      "brainReady": true, "testprepExists": false,
      "testprepCommand":"/mesa:ares-brain-testprep \"<course>\"" }
  ],

  "attendance": [               // per course, runway
    { "course","courseSlug",
      "attended":7,"conducted":9,"nowPct":77.8, "avgCp": 0,
      "sessionsLeftToMidterm":4, "sessionsLeftToEndterm":8,
      "bestCaseMidtermPct":85, "bestCaseEndtermPct":88,
      "floorEndtermPct":41,      // attend none from here
      "state": "ok"|"watch"|"risk", // risk = bestCaseEndtermPct < ARES_BRAIN_ATTENDANCE_MIN (unrecoverable); watch = not risk but at/below the line now or one more miss drops below it; ok = else
      "atRisk": true,            // convenience bool == (state != "ok")
      "note":"one more miss drops below 75%" }
  ],
  "attendanceMin": 75,

  "brain": [                    // per course, from brain_status + gaps
    { "course","courseSlug",
      "state":"ready"|"stale"|"not-built",
      "corpusBytes","sourceCount","indexStale",
      "guideBuiltAt": null, "guideSourcesBehind": 3,
      "pendingTranscripts": 6,
      "reason":"6 recordings to transcribe · guide 3 sources behind",
      "buildCommand":"/mesa:ares-brain-course-brain \"<course>\"" }
  ],

  "gaps": {
    "pendingTranscripts": [      // recordings.json minus transcripts/
      { "course","courseSlug","count":6,
        "items":[ {"title":"Session 1","recordedOn":"2026-08-21","videoUrl":"…"} ] } ],
    "missingBooks": [            // book-mention scan (see §4)
      { "title":"Resonate","author":"Nancy Duarte","mentionedIn":["power-of-communication"] } ],
    "scrapeStale": true,         // scrapeAgeHours > 26
    "attendanceStale": false     // _attendance.json older than _events.json
  }
}
```

Every field is derivable from data already on disk. `overview.py` never raises for one
bad course/file — per-item try/except, skip, continue.

## 4. `scraper/overview.py`

Module-top imports: stdlib + `from paths import ...` + `import brain` + `import daily_brief`.
NEVER `mesa_api` / `scrape_steps` / `calendar_sync` / `dotenv` / `requests`. A
`test_overview_import_isolation` guards it.

Blocks:

- **today** — call `daily_brief.build_daily_brief(now)`; reshape its `classesToday` /
  `assignmentsDue` / `changed`. `prereadRead` = does a transcript/notes file for that
  session exist, OR is there a `study/` marker — v1: `false` always unless a
  `courses/<slug>/brain/_read.json` set contains the preread path (a new tiny file the
  UI writes via a `POST /api/preread-read` — OPTIONAL, can defer; v1 just shows the
  preread, `prereadRead` omitted).
- **assignments** — `daily_brief._iter_assignment_files()` gives every assignment;
  keep `mySubmissionStatus != "submitted"`; `weightPct` from the grade-picture parse
  (match assignment title ↔ assessment component name, fuzzy); `risk` =
  `norm(weightPct or 5) * urgency(hoursAway) * (status != "draft" ? 1 : 0.6)`.
- **gradePicture / weightPct** — NEW parse. The outline (`normalized/outline*.md` body)
  has a section "3. Assessment and Evaluation" with rows like
  `| Classroom Participation | | 10% from Mesa | |` and
  `| Power of Communication | | Pitch 1: 30%<br>Pitch 2: 30% | |`. Parser:
  find the assessment block, pull every `<label> … <number>%` pair (regex
  `([A-Za-z][A-Za-z /&-]+?)\s*:?\s*(\d{1,3})\s*%`), dedupe, return
  `[{name, weightPct}]`. `done` = a submitted assignment whose title fuzzy-matches the
  component name (else `null` for CP / non-assignment rows). Tolerate no table → `[]`.
- **exams** — `_events.json` `eventType == "exam"`, future, sorted. `coverageSessions`
  from the title or `brain.next_session` index range if derivable, else null.
  `brainReady` = the course(s) it maps to are `state == "ready"` (or all courses for a
  program-wide exam). `testprepExists` = any `courses/<slug>/study/testprep-*.md`.
- **attendance** — `_attendance.json` `raw[]` matched to slug via `_index.json`
  `courseId`. `sessionsLeftToX` = count of `_events.json` future `session` events for
  that `courseSlug` with `startAt` date `<= examDate` (midterm = next `Mid Term`,
  endterm = last session in the calendar). `bestCaseX = round((attended + left) /
(conducted + left) * 100)`. `floorEndterm = round(attended / (conducted + leftEnd) *
100)`. `state` (`ok`/`watch`/`risk`) per the data model above; `atRisk` == `state != "ok"`. `note` computed for the `watch`/`risk` case.
- **brain** — `brain.brain_status(slug)` per course + `pendingTranscripts` (see gaps).
  `state`: `not-built` if `guideBuiltAt is None`; `stale` if `indexStale` OR
  `guideSourcesBehind > 0` OR `pendingTranscripts > 0`; else `ready`.
- **gaps.pendingTranscripts** — `len(raw/recordings.json)` minus
  `count(transcripts/*.md not starting "_")` (excluding `_failed.json`), with the
  untranscribed items listed (title, recordedOn, videoUrl).
- **gaps.missingBooks** — lift the book-mention scan from the `book-summary` skill into
  a reusable `overview._scan_missing_books()`: grep normalized transcripts + self-notes
  for `"<Title>" by <Author>` / known title patterns; subtract books already in
  `inbox/*/books/` or `type: book` docs. Best-effort; empty list is fine.
- **kpis** — derived from the above.

## 5. CLI + server route

- `scraper/lms_scrape.py`: `overview [--json]` subcommand → `overview.build_overview()`.
  Reads `courses/` off disk, no auth. `main_exit_code` unaffected (overview has no
  `ok`/`failed`/`errors` top-level keys).
- `dashboard/server/src/index.ts`: `GET /api/overview` → spawn `lms_scrape.py overview`
  (reuse the `runPython`-style helper; this is a one-shot, not a streamed job — a
  simpler `runPythonJSON(args): Promise<{ok, data|error}>` that buffers stdout and
  `JSON.parse`s the last `{`-line). 15s soft timeout. `guardOrigin` not needed (GET).
- `GET /api/state`, `POST /api/jobs`, SSE, `POST /api/upload` — unchanged.

## 6. Frontend — `dashboard/web` (React + shadcn + neobrutalism.dev)

### Migration + setup

- `package.json`: drop `preact`, `@preact/preset-vite`; add `react`, `react-dom`,
  `@vitejs/plugin-react`, `class-variance-authority`, `clsx`, `tailwind-merge`,
  `lucide-react`. `vite.config.ts`: `react()` instead of `preact()`. `tsconfig.json`:
  `jsx: "react-jsx"`, drop `jsxImportSource`.
- shadcn: `components.json` pointed at the **neobrutalism.dev** registry
  (`https://neobrutalism.dev/r/{name}.json` style) OR vendor their component files
  directly into `src/components/ui/` (registry may lag Tailwind v4 — vendoring is the
  safe path; the plan will decide after a spike in G3 step 1). Components needed:
  `card`, `button`, `badge`, `alert`, `progress`, `table`, `skeleton`.
- `src/index.css`: `@import "tailwindcss";` + `@theme` with palette B tokens
  (`--color-edge`, `--color-paper`, `--color-card`, `--color-accent`, `--color-cta`,
  `--color-ok/soon/bad`, `--radius: 2px`, `--shadow-nb: 4px 4px 0 var(--color-edge)`)
  - the neobrutalism base (`--border-width: 3px` etc). Dark block under
    `@media (prefers-color-scheme: dark)`.
- `src/api.ts`: add `getOverview(): Promise<Overview>` + the `Overview` TS type
  mirroring §3. Keep the existing job/upload/SSE fns.

### Layout (one page, `max-w-4xl`, palette B)

1. **Header** — `ARES BRAIN` chip, date, "scrape Xh ago" + a `[Sync]` button if stale.
2. **KPI strip** — 4–5 `NeoStat` tiles (Ant `Statistic` pattern): Due this week ·
   Next exam (Nd) · CP avg · Attendance now→best · Brain ready N/total. Amber tile fill
   when a KPI is in a warning band.
3. **Today** — classes (time, course, room, the one pre-read + a copy-path), what's due
   today/tomorrow with weight, what changed.
4. **This week** — `thisWeek[]` rows: date · title · course · a status badge
   (weight% / due-in / coverage) · the action (copy-command or `[job]` button).
5. **Assignments — by grade risk** — `assignments[]` sorted `risk` desc; each row:
   title, course, `weight% · due <rel> · <status>`, `[Start ↗]` (copies `helpCommand`).
   Then the `gradePicture[]` one-liners.
6. **Exam prep** — `exams[]`: name, date + countdown, coverage, `brain ready` /
   `no practice set` badges, `[Generate practice set ↗]` (copies `testprepCommand`).
7. **Attendance runway** — `attendance[]` rows: course · `nowPct%` · `N left` ·
   `best case midterm/endterm` · an amber flag for `state == "watch"`, a red flag + `note` for `state == "risk"`.
8. **Where you stand** — `brain[]` rows: course · state badge · `reason`. A `[Fix]`
   that either runs `ingest`+`brain-index` as a job (deterministic part) or copies
   `buildCommand`.
9. **Needs your input** — `gaps`: pending-transcripts groups with `[Transcribe all]`
   (job: `transcribe --inbox` after the user drops files, OR `transcribe-url` per
   item — v1: a `[Transcribe]` per group runs `transcribe --course <slug>` which pulls
   the YouTube links directly, no upload needed) · missing-books list with an upload
   dropzone · `scrapeStale` → `[Sync]` · `attendanceStale` note.
10. **Chat** — locked card: "N of M course brains ready — chat unlocks at K", progress
    bar, disabled input. When unlocked (still phase 2 for the actual chat), the card
    says "ready — phase 2".

- Any running job still shows the **JobLog** strip (kept from F) pinned above the
  footer; buttons disable while busy.
- `[copy]` actions write the command to the clipboard and toast "copied — paste in
  Claude Code".
- Loading: `Skeleton` rows per section while `/api/overview` resolves.

### Components (`src/components/`)

`Header`, `KpiStrip`, `TodayCard`, `WeekCard`, `AssignmentsCard`, `ExamsCard`,
`AttendanceCard`, `BrainCard`, `GapsCard`, `ChatLockCard`, `JobLog` (ported),
`CopyButton`, `RiskBadge`. Each ~40–80 lines, consumes a slice of `Overview`.

## 7. Testing

- **`scraper/tests/test_overview.py`** — a fixture `courses/` tree with: an outline
  containing an assessment table, 2 courses (one `ready`, one with pending transcripts +
  stale guide), `_attendance.json`, `_events.json` with future sessions + a mid-term +
  end-term exam, assignments with/without submission. Assert every block: `kpis`
  numbers, `assignments` risk ordering, `gradePicture` weight parse (incl. the
  `Pitch 1: 30%<br>Pitch 2: 30%` case), `exams` countdown + `testprepExists`,
  `attendance` best-case math (hand-computed), `brain` state per course, `gaps`
  pending-transcript diff, `missingBooks`. Plus: malformed `_attendance.json` /
  `_events.json` / a course with no outline → still returns a full dict.
- **`test_overview_import_isolation`** — subprocess import, assert no forbidden modules.
- **CLI** — `test_cli.py` gains `overview --json` dispatch.
- **server** — `routes.test.ts` gains `GET /api/overview` → 200 + shape (spawn stubbed
  or real against the fixture home).
- **web** — component tests for `KpiStrip` (renders the 5 tiles), `AssignmentsCard`
  (risk-desc order, copy button), `AttendanceCard` (`atRisk` row styled), `ChatLockCard`
  (locked vs unlocked by prop). `getOverview` parse test.
- **Visual** — dark + light screenshot of the built page against the fixture data.

## 8. Out of scope (this sub-project)

- The chatbot itself (phase 2). Only its locked-state card.
- Running `assignment-help` / `testprep` / `course-brain` from the dashboard (copy-command hand-off only).
- Writing to Nexus, editing `course.md` in the UI, historical trends / graphs over time.
- A real attendance _policy_ — the threshold is a labelled assumption.
- `prereadRead` tracking (deferred; the pre-read is shown, not checked off).

## 9. Build order

1. **`scraper/overview.py`** — all 7 blocks + assessment-table parser + attendance math + `overview` CLI + `test_overview.py` + import-isolation. Python only.
2. **`GET /api/overview`** — `runPythonJSON` helper + route + server test.
3. **`dashboard/web` React migration + neobrutalism.dev scaffold** — swap Preact→React, vendor/registry the shadcn neo components, palette B `@theme`, port `JobLog` + `api.ts` types, a blank `App` that fetches `/api/overview` and dumps it. Green build + the ported tests.
4. **The 10 sections** as components consuming `Overview`; `CopyButton` + toast; skeletons; job-strip integration; `[Transcribe]` / `[Sync]` / `[Fix]` job wiring.
5. **Glue + live run** — CI (web now React), `npm run check`, README "Dashboard" rewrite, screenshot light+dark against real data, `docs/lms-api.md` note.

Subagent-driven, TDD.
