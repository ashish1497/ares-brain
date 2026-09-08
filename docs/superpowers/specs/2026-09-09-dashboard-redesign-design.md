# Outcome dashboard — UX redesign

**Status:** approved 2026-09-09. Supersedes §6 (frontend) of
`2026-09-08-outcome-dashboard-design.md`; keeps §3/§4 (data model) with the
enrichment in §7 below. Lands on `g-dashboard` before it merges to `main`.

## 1. Why

The shipped dashboard is a single narrow column of same-weight cards — a wall,
not a view. No eagle view, no obvious refresh, `·`-separated metadata, one long
scroll. This redesign gives it a tabbed shell with a persistent summary bar, a
Today-first landing, a focused single-assignment page, full-width layout, a
deliberate spacing/colour system, and a theme picker.

The whole-branch review of the current build found 4 data-layer bugs that must be
fixed regardless (§8). They fold into the data task.

## 2. Locked decisions

- **Shell:** persistent summary bar (sticky) + tab bar (sticky) + tab body.
- **Eagle view:** the **Today** tab is the landing view and the eagle view.
- **Assignments:** list → click → **focused single-assignment page** (not inline
  expand). Route state in the URL hash.
- **Layout:** full-width, `max-width: 1400px`, centered.
- **Dividers:** no `·` / middot anywhere. Horizontal hairline rules between list
  rows; a 3px rule under each section header; 1px vertical rules between inline
  metadata spans.
- **Themes:** `Meadow` (green) and `Ultraviolet` (violet+cream+yellow), each ×
  `System` / `Light` / `Dark`, chosen in a Settings panel, persisted in
  `localStorage`, applied via `data-theme` + `data-appearance` on `<html>`.
- Chat stays locked (phase 2). No LLM calls from the dashboard.

## 3. Spacing system

4px base unit. The only spacing values used:

| token | px | use |
| --- | --- | --- |
| `1` | 4 | icon↔label, tightest |
| `2` | 8 | label↔value, chip internals |
| `3` | 12 | inline metadata group gap, list row padding-y |
| `4` | 16 | card padding (mobile), control height rhythm |
| `6` | 24 | card padding (desktop), gap between sections/cards |
| `8` | 32 | page top/bottom padding |
| `12` | 48 | major vertical breaks inside a tab |

- Page: `mx-auto max-w-[1400px] px-4 md:px-8`.
- Summary bar: `h-14`, `px-4 md:px-8`, chips `gap-3`.
- Tab bar: `h-11`, tab `px-4`.
- Card / panel: `p-4 md:p-6`, corners `rounded-nb` (2px).
- Card stack inside a tab: `space-y-6`.
- List: `divide-y divide-rule`, each row `py-3`.
- Section header: uppercase 11px / `tracking-[0.08em]` / `font-bold`, a
  `border-b-[3px] border-edge` beneath, `pb-2 mb-4`.

## 4. Colour system

Fixed token names; values swap by theme. Every theme defines all of:

`--color-edge` `--color-paper` `--color-card` `--color-ink` `--color-rule`
`--color-cta` `--color-accent` `--color-ok` `--color-soon` `--color-bad`
plus `--nb-border: 3px`, `--nb-shadow: 4px 4px 0 var(--color-edge)`,
`--radius-nb: 2px`.

Rules:

- **`edge`** is the only structural colour — borders, the offset shadow, header
  rules, focus rings, active-tab outline. Nothing else is structural.
- **`paper` vs `card`** are two steps of one neutral. The card is told apart by
  its border + shadow, not a large value jump.
- **`ink`** is the only text colour. Muted text = `color-mix(in srgb, var(--color-ink) 60%, transparent)`; disabled = 40%. No other greys.
- **`cta`** (yellow in both themes) is the single primary action per view —
  copy-command buttons, Re-sync, the one primary CTA. Never a wash, never
  decoration.
- **`accent`** is links and secondary actions (`Open →`, sort toggles).
- **`ok` / `soon` / `bad`** are status only: solid pills (fill + black text +
  `edge` border) and row tints (`color-mix(... 8%, var(--color-card))`).
- **`rule`** = `color-mix(in srgb, var(--color-edge) 15%, transparent)` — the
  hairline divider between rows.

Contrast floors (checked at build-review): `ink` on `paper` and on `card` ≥ 7:1;
black on every bright fill (`cta`/`ok`/`soon`/`bad`) ≥ 4.5:1; `edge` on `paper`
≥ 3:1.

### 4.1 Meadow (default)

| token | light | dark |
| --- | --- | --- |
| edge | `#0f8a5f` | `#16b981` |
| paper | `#eafff4` | `#141a17` |
| card | `#ffffff` | `#1f2723` |
| ink | `#0e2119` | `#eafff4` |
| cta | `#ffd23f` | `#ffd23f` |
| accent | `#e8590c` | `#ff8a4c` |
| ok | `#2f9e44` | `#51cf66` |
| soon | `#f08c00` | `#ffc078` |
| bad | `#e03131` | `#ff6b6b` |

### 4.2 Ultraviolet

| token | light | dark |
| --- | --- | --- |
| edge | `#5b21b6` | `#a78bfa` |
| paper | `#faf3e0` | `#17121f` |
| card | `#fffdf7` | `#211a2e` |
| ink | `#241436` | `#f3ecff` |
| cta | `#ffd23f` | `#ffd23f` |
| accent | `#7c3aed` | `#c4b5fd` |
| ok | `#2f9e44` | `#51cf66` |
| soon | `#f08c00` | `#ffc078` |
| bad | `#e03131` | `#ff6b6b` |

### 4.3 CSS structure (Tailwind v4)

`@theme` holds the Meadow-light values (so the utilities exist). Real theming is
runtime `:root` overrides — **never `@theme` inside an at-rule** (that was the
bug in the current build):

```css
@import "tailwindcss";
@theme { /* Meadow light — defines --color-* + the utilities */ }

/* appearance: system → follow the OS unless the user forced light */
@media (prefers-color-scheme: dark) {
  :root:not([data-appearance="light"]) { /* Meadow dark */ }
  :root:not([data-appearance="light"])[data-theme="violet"] { /* UV dark */ }
}
/* explicit appearance wins both ways */
:root[data-appearance="dark"] { /* Meadow dark */ }
:root[data-appearance="dark"][data-theme="violet"] { /* UV dark */ }
:root[data-appearance="light"][data-theme="violet"],
:root:not([data-appearance="dark"])[data-theme="violet"] { /* UV light */ }
```

`--color-rule` and the muted-ink mix are derived once from `--color-edge` /
`--color-ink` and need no per-theme entry. `body { background: var(--color-paper); color: var(--color-ink); }`.

## 5. Shell

### 5.1 Summary bar (`Header.tsx`)

Sticky, `z-20`, `border-b-[3px] border-edge`, `bg-paper`.

- Left: `ARES BRAIN` wordmark (small `cta` neubrutalist tag) + `Wed 9 Sep · Term 1` — the `·` here is acceptable as a wordmark date, or use a 1px rule; pick the rule for consistency.
- Center (hide < md, move into a drawer): four stat chips —
  `2 due` · `74→89% att` · `exam 10d` · `brain 2/17`. A chip turns `soon`-tinted
  when: `dueThisWeek >= 3`, `nextExamInDays !== null && <= 7`,
  `attendanceNow < attendanceMin`, `brainReady < chatUnlockAt`.
- Right: `updated 9h ago` (muted) + **⟲ Re-sync** (`cta` button — runs `sync`)
  + a **gear** button opening Settings.
- While a job runs: the Re-sync button shows `syncing…` + disables; the job-log
  strip (bottom-right, unchanged behaviour) shows the stream.
- Keyboard: `r` triggers Re-sync when no input is focused.

### 5.2 Settings panel

A popover/panel anchored to the gear (or a right-side sheet on mobile).

- **Theme:** two swatch buttons — `Meadow`, `Ultraviolet` — each a mini preview
  (paper + card + edge + cta). Selected = pressed neubrutalist state.
- **Appearance:** segmented control `System | Light | Dark`.
- Writes `localStorage["ares.theme"]` (`meadow` | `violet`) and
  `localStorage["ares.appearance"]` (`system` | `light` | `dark`); a
  `applyTheme()` helper sets `document.documentElement.dataset.theme` /
  `.appearance` and runs on load before first paint (inline in `index.html` head
  to avoid a flash, or a blocking module).
- Also lists, read-only: `attendance minimum 75% (ARES_BRAIN_ATTENDANCE_MIN)`,
  `chat unlock 15 (ARES_BRAIN_CHAT_UNLOCK)`, `port 4319`.

### 5.3 Tab bar (`Tabs.tsx`)

Sticky under the summary bar, `bg-paper`, `border-b border-rule`.

Tabs: `Today` · `Assignments` (badge = open count) · `Attendance` · `Exams` ·
`Brain` · `Gaps` (badge = total gap items). Active tab: `bg-card`,
`border-[3px] border-edge`, shadow removed, `translate-y-[2px]` — the pressed
look. Inactive: `border-transparent`, hover `bg-card/60`.

Hash routing: `#today` (default), `#assignments`,
`#assignments/<courseSlug>/<id>` (focused page), `#attendance`, `#exams`,
`#brain`, `#gaps`. A tiny `useHashRoute()` hook — no router dependency. Re-sync
and job refreshes must not change the hash.

## 6. Tabs

### 6.1 Today (`TodayTab.tsx`) — landing

`grid lg:grid-cols-[1.15fr_1fr] gap-6`.

- **Left — class timeline** (`ClassTimeline.tsx`): a vertical rail. Each class:
  `09:30–11:00` (time, `font-bold`), course, then a muted line `room ·
  instructor` → use a 1px vertical rule between room and instructor, not `·`.
  A state marker on the rail dot: `now` (filled `ok`), `in 2h` (hollow), `done`
  (filled muted). Pre-read → a small `accent` chip `pre-read` linking to
  `#` (course brief copy-command in a tooltip). Empty → "no classes today".
- **Right, top — Due now** (`DueNow.tsx`): `today.dueTodayOrTomorrow`. Row:
  title, course (muted), `in 24h` (or `soon` pill if `< 6h`), `Open →`
  (→ `#assignments/<slug>/<id>` when the id resolves, else scrolls the
  Assignments tab). Submitted → struck + `ok` check, sorted last.
- **Right, bottom — Since last scrape** (`ChangedFeed.tsx`): `today.changed`
  with **course names** (see §7), one row per course: `4 announcements ·
  1 material` → render counts as pills, not `·` text. Muted header
  `since <relative scrape age>`.
- Both-empty → one calm panel: "Nothing needs you today. Next class <time>."

### 6.2 Assignments (`AssignmentsTab.tsx`)

List view:

- Header strip: `4 open` · `2 due this week` · `worst: <title> (<weight>)` —
  1px rules between, not `·`.
- List, `divide-y divide-rule`, ordered by `risk` desc. Row:
  a status square (`not-started` = `bad` outline, `draft` = `soon`, `submitted`
  = `ok` fill), title (`font-medium`), course (muted), then a right-aligned
  meta group: `weight` · `due` · `Open →` separated by 1px vertical rules.
  `due` is `bad` text when `< 48h` or overdue. Ungraded / club rows: meta shows
  `ungraded`, row `opacity-80`.
- Below the list, `mt-6 border-t border-rule pt-6`: **Grade picture**
  (`GradePicture.tsx`) — per course a horizontal bar: filled segment =
  `100 - aheadPct` (done), hollow = `aheadPct`; label = course name + the
  `summary` line beneath, muted.

Focused page (`AssignmentPage.tsx`, hash `#assignments/<slug>/<id>`): replaces
the tab body.

- `← all assignments` link (sets hash back to `#assignments`).
- Title (h1), course, badge row: `weight` or `ungraded` · `group`/`solo` ·
  `submissionType` · status — pills, `edge` border.
- **Deadline** panel: `due <date> <time>`; if `cutoffAt` differs, `hard cutoff
  <…>`; `late allowed` / `no late submissions`; a live countdown (`bad` under
  24h).
- **What's being asked** panel: `instructionsText` (§7) rendered as paragraphs.
  If empty → "No instructions were scraped — check the LMS."
- **Attached materials** panel: list of `title` + a `kind` pill. Footnote:
  "download these from the LMS Resources tab" (no proxying in phase 1).
- **Maps to** panel: `Session <sessionRef>` + that session's pre-reads as links,
  and a copy-command `/mesa:ares-brain-course-brief "<course>"`. Omit if
  `sessionRef` is null.
- **Start in Claude** panel: the `helpCommand` in a large `CopyButton` (yellow),
  one muted line "paste in Claude Code".
- **Checklist** panel (`AssignmentChecklist.tsx`): steps persisted to
  `localStorage["ares.checklist." + id]` as `{text, done}[]`. Add (input +
  enter), toggle, delete. A `status` segmented control `not started | started |
  submitted` also persisted locally (`ares.localstatus.<id>`) — advisory only,
  shown as a note that it is local and not sent to the LMS.

### 6.3 Attendance (`AttendanceTab.tsx`)

- Top line: `attended <X> of <Y> — <Z>% overall · best case <W>%` (1px rules) and
  a muted `assumes ≥ 75% (ARES_BRAIN_ATTENDANCE_MIN)`.
- Full-width table, columns: `Course` · `Now` · `Held` · `Left` ·
  `Best case (mid / end)` · `Floor` · `State`. Header row `border-b-[3px]
  border-edge`; body `divide-y divide-rule`. Row background =
  state tint (8%). `State` cell = pill (`on track` `ok` / `watch` `soon` /
  `at risk` `bad`); the `note` renders as a muted second line in the `State`
  cell on watch/risk only. Sortable by `Now` and by risk (default risk desc).

### 6.4 Exams (`ExamsTab.tsx`)

Card per exam by date. Title, `<date> · <countdown>` (1px rule), scope =
`courseNames.join(", ")` or `all courses`. Two pills: `brain ready` (`ok`) /
`brain not ready` (`bad`); `practice set ✓` (`ok`) / `no practice set` (muted).
Actions: **Make practice set** (`CopyButton`, the interpolated
`testprepCommand` — see §8.4) — for `all` exams, one button per course in
`courseNames`; **Brief me** (`CopyButton`, `course-brief`) when brain not ready.

### 6.5 Brain (`BrainTab.tsx`)

- Header: `2 of 17 course brains ready — chat unlocks at 15` + a `Progress`
  bar (`brainReady / chatUnlockAt`). Absorbs the old ChatLockCard.
- Table: `Course` · `State` (pill: `ready` `ok` / `stale` `soon` /
  `not-built` `bad`) · `Why` (the `reason`, muted) · `Corpus` (KB, `—` when 0) ·
  `Actions`. Actions: **Ingest** (job button, when not `ready`) · **Build
  guide** (`CopyButton`, `buildCommand`). Sort not-built → stale → ready.

### 6.6 Gaps (`GapsTab.tsx`)

Three panels, each hidden when empty; if all empty → "Nothing outstanding."

- **Transcripts**: per group `6 recordings · <course>` + **Transcribe all**
  (job `transcribe`, `{course: courseSlug}`). A disclosure shows the session
  list (`title` · `recordedOn`).
- **Missing books**: per book `title` — `author`, muted `mentioned in
  <courseName>`, and a PDF drop target that calls `upload(mentionedIn[0],
  "book", files)` and reports `written` / `rejected`. Correct hint text:
  `drop a PDF here, or put it in courses/<slug>/inbox/books/` (§8 follow-up).
  Keyed by `title`, not index.
- **Stale**: `scrape is N days old` + **Re-sync**; `attendance data is behind
  the calendar` (muted note).

## 7. Data model changes (`overview.py`)

Additive to `2026-09-08-outcome-dashboard-design.md` §3/§4.

- `assignments[]` and `today.dueTodayOrTomorrow[]` rows gain:
  - `instructionsText: string` — the raw `instructions` HTML converted to plain
    text: `<li>`/`</p>`/`<br>` → newline, tags stripped, entities unescaped,
    collapsed blank lines, capped at 2000 chars. Pure-stdlib helper in
    `overview.py` (`_html_to_text`). `""` when absent.
  - `isGroup: bool` (from `isGroup`), `cutoffAt: string | null`
    (`cutoffDate` when it differs from `dueAt`, else null),
    `allowLate: bool` (`allowLate`, default false),
    `materials: [{ title, kind }]` (from `materials[]`; empty list when none).
  - `sessionRef: number | null` — the integer N from a leading
    `Session <N>` / `Session-<N>` in the title, else null.
  - `prereadPaths: string[]` — the outline pre-reads for `sessionRef` in that
    course, resolved the same way `daily_brief` does it; `[]` when unresolved.
    Must not import beyond the isolation allowlist — reuse a `daily_brief`
    helper or read the outline file directly.
- `today.changed` → `today.changed: { courseName, courseSlug, counts:
  {<kind>: n} }[]` (a list with names resolved), replacing the slug-keyed map.
  Update `daily_brief`/`overview` producers and the `Overview` type + tests.
- The `assignments[]` full detail is read from
  `courses/<slug>/raw/assignments.json` (list of records with `id`, `title`,
  `instructions`, `submissionType`, `isGroup`, `dueAt`, `cutoffDate`,
  `allowLate`, `mySubmissionStatus`, `materials[]`). `overview.py` already
  iterates these files; thread the extra fields through.

## 8. Must-fix data-layer bugs (from the whole-branch review)

All in `scraper/overview.py`; each gets a test that would fail today.

1. **Exam / this-week countdown off by one.** `inDays` and the
   `0 <= days <= 7` window subtract **UTC** calendar dates while `date` is
   local. Compute `today_local = now.astimezone().date()` once and compare
   against `dt.astimezone().date()` everywhere (`inDays`, the this-week filter).
   Add a test run under a non-UTC `TZ`.
2. **`build_overview` raises on `_attendance.json` `{"raw": null}`.** The
   `cp_vals` comprehension iterates `att_list` without the `isinstance(list)`
   guard the row loop has. Hoist `att_list = att_list if isinstance(att_list,
   list) else []` once. Test the `{"raw": null}` and `{"raw": 5}` cases →
   `build_overview` still returns a full dict.
3. **Grade picture / risk are wrong on real data.**
   - `done` must be able to be `False`, not only `True`/`None` (the
     `... or None` collapses it). Emit `False` for components the parser treats
     as assignment-backed.
   - Component↔submission matching (`_name_match`) never matches a *category*
     ("Weekly Assignments") against an *instance* ("Session 3 Nykaa Workbook").
     Broaden: token-overlap or a keyword map (`workbook`, `assignment`, `case`,
     `quiz`, `reflection`, `pitch`, `presentation`, `viva`), so a category with
     a matching keyword counts its instances toward `done`.
   - `_weight_for` returns nothing for real assignment titles → `weightPct`
     null → `risk` base `5/30` → everything green. Either resolve a weight via
     the same broadened matching, or when no weight resolves, floor the risk
     band so an **overdue** or `< 24h` item is never `ok`/green, and word the
     grade `summary` as "not yet marked complete" rather than asserting a %.
   - Add a positive test asserting `done is True` for a real category+instance
     pair (nothing asserts the true branch today).
4. **`testprepCommand` ships a literal `<course>`.** Interpolate
   `_q(slugs.get(cslug, cslug))` for course-scoped exams; for `all` exams emit
   one command per `courseNames` entry (the frontend renders a button each).

### Folded-in follow-ups (do with the above where cheap)

- `_name_match` returns `False` for identical strings ending in `)` — use
  `(?<!\w)` / `(?!\w)` instead of `\b`.
- `parse_assessment` scans the whole outline when the "Assessment and
  Evaluation" header is absent → return `[]` instead.
- `testprepExists` for an `all` exam uses `any()` across every course → use
  `all()` (or per-course, but `all()` is the honest single bool).
- `_safe(fn, empty)` logs `<lambda>` — take an explicit `label` argument.
- `risk` saturates for any `weightPct >= 30` (`base = weightPct / 30`) — scale
  by a larger divisor (e.g. `/ 50`) or a sqrt curve so 30 and 60 differ.
- `calendar-sync` job kind: add it to the server (`KINDS`, `argv()` →
  `["calendar-sync"]`) and surface **Sync calendar** in the Gaps "stale" panel
  and/or Settings — the spec's runnable-actions list includes it and the CLI
  subcommand exists.
- `GapsCard` upload hint path → `courses/<slug>/inbox/books/`.
- `App` (now the shell): a failed refresh after a good first load must show a
  non-blocking banner, not silently keep stale data.
- Drop the unused vendored `ui/` files (`skeleton`, `table`, `card` if still
  unused after the rebuild) and the unused `lucide-react` dep, OR use them.

### Server

- `dashboard/server/test/overview.test.ts` asserts nothing meaningful in CI
  (always the 503 branch). Add a `runPythonJSON` unit test with a stubbed spawn:
  last-`{`-line parse, non-zero exit → `{ok:false}`, timeout → `{ok:false,
  error:"timeout"}`.
- Keep `guardOrigin`'s **Host** check on `GET /api/overview` too (cheap, and
  this endpoint now returns the full academic record + spawns a subprocess);
  add a single in-flight dedupe so repeated GETs share one Python run.

## 9. Components / files

```
dashboard/web/src/
  main.tsx, index.css               # theme token matrix (§4.3)
  lib/theme.ts                      # applyTheme(), read/write localStorage
  lib/useHashRoute.ts
  lib/format.ts                     # relative time, date, countdown (locale-safe)
  api.ts                            # Overview type += §7 fields; getOverview unchanged
  App.tsx                           # shell: <Header/> <Tabs/> {route → tab}
  components/
    Header.tsx  Settings.tsx  Tabs.tsx  JobLog.tsx
    SectionHeader.tsx  MetaRow.tsx  CopyButton.tsx  StatePill.tsx  Rule.tsx
    today/ ClassTimeline.tsx DueNow.tsx ChangedFeed.tsx
    assignments/ AssignmentsTab.tsx GradePicture.tsx AssignmentPage.tsx AssignmentChecklist.tsx
    AttendanceTab.tsx  ExamsTab.tsx  BrainTab.tsx  GapsTab.tsx
  components/ui/*                    # vendored kit — keep button/badge/progress/alert; drop unused
```

## 10. Testing

- Python: the §8 fixes each get a failing-first test; `overview.py` enrichment
  (`_html_to_text`, `sessionRef` parse, `materials` map, `changed` name
  resolution) each get a test; `attendance_runway` / `parse_assessment` existing
  tests stay green. Non-UTC `TZ` test for the countdown.
- Server: `runPythonJSON` unit test (stubbed spawn); `transcribe` +
  `calendar-sync` argv tests; `/api/overview` Host-guard test.
- Web: one test per tab component (renders its slice, counts, empty state);
  `useHashRoute` (parse + navigate); `theme.applyTheme` (writes dataset, reads
  storage, falls back); `AssignmentPage` (renders instructions, copy carries
  `helpCommand`, checklist persists via mocked `localStorage`, back returns);
  `Settings` (swatch + segmented control write storage and re-apply);
  `Header` chip tint thresholds; `CopyButton` success-only note (already).
- `npm run check` stays green (0 errors). CI `dashboard` job unchanged.

## 11. Out of scope (unchanged from the outcome-dashboard spec)

Chatbot / any LLM call from the dashboard; LMS write-back (the local status
toggle is advisory); material download proxying; server auth; multi-user.

## 12. Build order

1. **T1** `overview.py` — §8 must-fix + folded follow-ups + §7 enrichment.
   `+` server: `calendar-sync` job kind, `runPythonJSON` unit test, Host guard
   on the overview GET.
2. **T2** shell — `index.css` theme matrix, `lib/theme.ts`, `Settings.tsx`,
   `Header.tsx` (summary bar + Re-sync + gear), `Tabs.tsx`, `useHashRoute`,
   `App.tsx` wiring, shared `SectionHeader`/`MetaRow`/`Rule`/`StatePill`.
   Tabs render placeholder bodies.
3. **T3** Today tab — `ClassTimeline`, `DueNow`, `ChangedFeed`.
4. **T4** Assignments — list + `GradePicture` + `AssignmentPage` +
   `AssignmentChecklist`.
5. **T5** Attendance + Exams + Brain + Gaps tabs.
6. **T6** glue — `npm run check`, CI, live run (both themes × light/dark,
   screenshots), README "Dashboard" rewrite, `docs/lms-api.md` note. Then the
   whole-branch review of `g-dashboard` and merge.
