# Dashboard UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the outcome dashboard as a tabbed, full-width app with a Today-first landing, a focused single-assignment page, a theme picker, and the whole-branch review's data-layer bugs fixed.

**Architecture:** `overview.py` gains assignment detail + name-resolved `changed` + the review fixes (T1). `dashboard/web` is re-composed: a sticky summary bar + sticky tab bar + hash-routed tab bodies replace the single scroll; a `lib/theme.ts` + `index.css` token matrix drive two themes × three appearances (T2). Tabs built T3–T5. Glue + live run + merge in T6. The data layer, MCP server (bar two additive changes), and job runner are unchanged.

**Tech Stack:** Python 3.12 stdlib (`overview.py`), Node `http` + TS (`dashboard/server`), React 18 + Vite 6 + Tailwind v4 + vendored neobrutalism kit + Vitest + @testing-library/react (`dashboard/web`).

**Spec:** `docs/superpowers/specs/2026-09-09-dashboard-redesign-design.md` (supersedes §6 of `2026-09-08-outcome-dashboard-design.md`; §3/§4 data model still apply with the T1 enrichment).

**Branch:** `g-dashboard` (already checked out; base `main` @ `2ff0094`). All tasks commit here. Merge to `main` is T6's last step after a fresh whole-branch review.

## Global Constraints

- `scraper/overview.py` module-top imports: **stdlib + `from datetime import ...` + `from pathlib import Path` + `from paths import ...` + `import brain` + `import daily_brief` ONLY**. Never `scrape_steps`/`mesa_api`/`dotenv`/`requests`/`calendar_sync`. Guarded by `test_overview_import_isolation` (subprocess import check). Reason: those transitively `load_dotenv(.env)`.
- `overview.py` is pure — reads `courses/` off disk, no LMS auth, no LLM, no network. It must **never raise for one bad course/file**: per-item `try/except Exception: continue`, diagnostics to `sys.stderr` (stdout is the `--json` channel).
- `dashboard/server` binds `127.0.0.1` only, no auth. `guardOrigin` (Host/Origin allowlist) on every POST. `courseAllowed`/`courseSlugOk` reject `.`, `..`, `/`. One job at a time — a second while `current?.status === "running"` → `BusyError` → HTTP 409.
- Web UI: neubrutalism — `var(--nb-border)` = 3px borders, `var(--nb-shadow)` = `4px 4px 0 var(--color-edge)`, `var(--radius-nb)` = 2px, **no gradients**. Colour + spacing per spec §3/§4 — the only spacing values are 4/8/12/16/24/32; `edge` is the only structural colour; `cta` (yellow) is the single primary action per view; `ok`/`soon`/`bad` are status-only. **No `·` / middot separators** — hairline `border` rules between rows, a `border-b-[3px] border-edge` under section headers, 1px vertical `border` rules between inline metadata.
- Token names are fixed (`--color-edge`, `--color-paper`, `--color-card`, `--color-ink`, `--color-rule`, `--color-cta`, `--color-accent`, `--color-ok`, `--color-soon`, `--color-bad`); only values swap by `[data-theme]` / `[data-appearance]`. **Never `@theme` inside an at-rule** (Tailwind v4 flattens it — that was the shipped bug).
- `npm run check` (root) must stay green: `prettier --check . && eslint . && mcp check && ares-dashboard-web check && dashboard:build`. 0 errors. Pre-existing `no-explicit-any` warnings in `dashboard/server/test/*` are known/accepted. The pre-commit hook runs prettier + eslint --fix on staged files — match existing style (2-space, double quotes, trailing commas).
- CI (`.github/workflows/ci.yml`) `dashboard` job runs `npm ci` (Node 20) + build + web check + test. Keep the `package-lock.json` reifiable by a clean `npm ci`.
- Commit message bodies end with:
  `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`
- Vitest counts at plan start: scraper pytest **229**, server **31**, web **49**. They will rise.

---

## File Structure

```
scraper/
  overview.py                 # T1: _html_to_text, _session_ref, assignment enrichment,
                              #     changed name-resolution, + review fixes (countdown TZ,
                              #     att_list guard, done/False + keyword match, testprepCommand,
                              #     parse_assessment header-required, testprepExists all(),
                              #     _safe label, risk divisor, _name_match end-of-string)
  tests/test_overview.py      # T1: failing-first test per fix + per enrichment
  tests/test_cli.py           # T1: unchanged unless a shape assertion moves
dashboard/server/src/
  lib/jobs.ts                 # T1: + "calendar-sync" JobKind + argv case
  index.ts                    # T1: + "calendar-sync" in KINDS; Host guard on GET /api/overview
  lib/python.ts               # T1: (no change) — runPythonJSON already exists
dashboard/server/test/
  jobs.test.ts                # T1: calendar-sync argv test
  routes.test.ts              # T1: GET /api/overview Host-guard test
  python.test.ts  (new)       # T1: runPythonJSON unit test (stubbed spawn)
dashboard/web/src/
  index.css                   # T2: theme token matrix
  lib/theme.ts   (new)        # T2: applyTheme(), storage read/write
  lib/useHashRoute.ts (new)   # T2
  lib/format.ts  (new)        # T2: relTime/fmtDate/countdown (locale-safe, "+T00:00" trick)
  api.ts                      # T1-shape: Overview type += enrichment fields
  App.tsx                     # T2: shell — <Header/> <Tabs/> {route→body}
  main.tsx                    # T2: applyTheme() before render
  components/
    Header.tsx  Settings.tsx  Tabs.tsx  (T2)
    SectionHeader.tsx MetaRow.tsx Rule.tsx StatePill.tsx CopyButton.tsx  (T2; CopyButton port)
    JobLog.tsx                (T2: restyle to tokens)
    today/ClassTimeline.tsx today/DueNow.tsx today/ChangedFeed.tsx  (T3)
    assignments/AssignmentsTab.tsx assignments/GradePicture.tsx
    assignments/AssignmentPage.tsx assignments/AssignmentChecklist.tsx  (T4)
    AttendanceTab.tsx ExamsTab.tsx BrainTab.tsx GapsTab.tsx  (T5)
  components/ui/*              # keep button/badge/progress/alert; delete skeleton/table/card if unused after T5
dashboard/web/test/           # a test file per component above
README.md  docs/lms-api.md    # T6
```

Old components deleted in T2 (superseded): `KpiStrip, TodayCard, WeekCard, AssignmentsCard, ExamsCard, AttendanceCard, BrainCard, GapsCard, ChatLockCard, RiskBadge` and their tests. `Header.tsx` is rewritten.

---

## Task 1: `overview.py` — data fixes + assignment enrichment + 2 server additions

**Files:**

- Modify: `scraper/overview.py`
- Modify: `scraper/tests/test_overview.py`
- Modify: `dashboard/server/src/lib/jobs.ts`, `dashboard/server/src/index.ts`
- Modify: `dashboard/server/test/jobs.test.ts`, `dashboard/server/test/routes.test.ts`
- Create: `dashboard/server/test/python.test.ts`

**Interfaces produced (consumed by T2–T5 via `api.ts` `Overview`):**

- `assignments[]` and `today.dueTodayOrTomorrow[]` rows each add:
  `instructionsText: string`, `isGroup: boolean`, `cutoffAt: string | null`,
  `allowLate: boolean`, `materials: {title: string, kind: string}[]`,
  `sessionRef: number | null`, `prereadPaths: string[]`.
- `today.changed`: now `{courseName: string, courseSlug: string, counts: Record<string, number>}[]` (was a slug-keyed map).
- `gradePicture[].components[].done`: now `boolean | null` (false is reachable).
- `exams[].testprepCommand`: interpolated per course; `exams[].testprepCommands: {course: string, command: string}[]` for `["all"]` exams.
- server: `JobKind` gains `"calendar-sync"`; `POST /api/jobs {kind:"calendar-sync"}` → 202, argv `["calendar-sync"]`; `GET /api/overview` now also runs `guardOrigin`.

### Part A — review fixes

- [ ] **Step 1: failing test — exam countdown uses local dates**

Add to `test_overview.py`:

```python
def test_exam_countdown_is_local_not_utc(monkeypatch):
    monkeypatch.setenv("TZ", "Asia/Kolkata")
    time.tzset()
    try:
        # 2026-09-09 23:00 IST == 2026-09-09 17:30 UTC; exam on 2026-09-19 local
        now = datetime(2026, 9, 9, 17, 30, tzinfo=timezone.utc)
        ov = overview.build_overview(now=now)
        ex = next((e for e in ov["exams"] if e["date"] == "2026-09-19"), None)
        assert ex is not None
        assert ex["inDays"] == 10          # 19 - 9, in local time — not 11
    finally:
        monkeypatch.delenv("TZ", raising=False)
        time.tzset()
```

(If the fixture `_events.json` has no 2026-09-19 exam, add one, or assert on whichever exam date the fixture carries with the corrected arithmetic.)

- [ ] **Step 2: run it — FAIL** (`inDays` == 11)

`cd scraper && uv run pytest tests/test_overview.py::test_exam_countdown_is_local_not_utc -q` → FAIL.

- [ ] **Step 3: fix the date arithmetic**

In `build_overview`, compute once near the top: `today_local = now.astimezone().date()`.

- `_exams` / the exam-row loop: `"inDays": (s_dt.astimezone().date() - today_local).days`.
- the this-week filter (line ~484): `if 0 <= e["inDays"] <= 7` is fine once `inDays` is local; the class/assignment `when` filter (line ~497) must also compare `d.astimezone().date()` to `today_local`, and drop anything `< today_local`.
- `daily_brief._local_date` already uses `.astimezone()` — leave it.

- [ ] **Step 4: run — PASS**, then full `uv run pytest -q` — green.

- [ ] **Step 5: failing test — malformed `_attendance.json` `{"raw": null}`**

```python
def test_attendance_raw_null_tolerated(tmp_path, monkeypatch):
    _seed_min_corpus(tmp_path)   # or the existing fixture helper
    (tmp_path / "courses" / "_attendance.json").write_text('{"raw": null}')
    monkeypatch.setenv("ARES_BRAIN_HOME", str(tmp_path))
    ov = overview.build_overview(now=NOW)
    assert isinstance(ov, dict) and "kpis" in ov and "attendance" in ov
```

- [ ] **Step 6: run — FAIL** (`TypeError: 'NoneType' object is not iterable`).

- [ ] **Step 7: fix** — in `build_overview`, right after `att_list` is read:

```python
att_list = att_list if isinstance(att_list, list) else []
```

and delete the inline `if isinstance(att_list, list) else []` on the row loop. The `cp_vals` comprehension then iterates the guarded list.

- [ ] **Step 8: run — PASS**, full pytest green.

- [ ] **Step 9: failing test — grade `done` can be `False`, category matches instances**

```python
def test_grade_done_true_for_category_with_submitted_instance(...):
    # course outline component "Weekly Assignments" (15%); a submitted
    # "Session 3 Nykaa Workbook" assignment in raw/assignments.json
    ov = overview.build_overview(now=NOW)
    gp = next(g for g in ov["gradePicture"] if g["courseSlug"] == "sell")
    wk = next(c for c in gp["components"] if "Weekly" in c["name"] or "workbook" in c["name"].lower())
    assert wk["done"] is True
    # and a component with no matching submission is explicitly False, not None
    assert any(c["done"] is False for c in gp["components"])
```

(Extend the fixture corpus: a course with an assessment table containing a
category component + a submitted instance assignment whose title shares a
keyword.)

- [ ] **Step 10: run — FAIL.**

- [ ] **Step 11: fix the matching + `done` tri-state**

- Add a keyword set near `_name_match`:

```python
_COMPONENT_KEYWORDS = {
    "workbook", "assignment", "case", "quiz", "reflection", "pitch",
    "presentation", "viva", "submission", "project", "essay", "report",
}
def _component_matches(component_name: str, submission_title: str) -> bool:
    if _name_match(component_name, submission_title):
        return True
    cn, st = component_name.lower(), submission_title.lower()
    return any(k in cn and k in st for k in _COMPONENT_KEYWORDS)
```

- grade-picture loop: `matched = any(_component_matches(c["name"], t) for t in subs)`;
  `done = True if matched else (False if <component looks assignment-backed> else None)`.
  "assignment-backed" heuristic: the component name contains any `_COMPONENT_KEYWORDS`
  token (participation / attendance style rows stay `None`). Keep `aheadPct` summing
  weights where `done is not True`.
- `_weight_for` / the assignment `w`: use `_component_matches` too.
- also fix `_name_match` end-of-string: replace `\b{re.escape(a)}\b` with
  `(?<!\w){re.escape(a)}(?!\w)` both directions.

- [ ] **Step 12: run — PASS**; check `test_weight_match_is_word_bounded` and
      `test_parse_assessment_keeps_parenthetical_qualifier` still pass (adjust the
      latter's downstream assertion if it now matches).

- [ ] **Step 13: risk divisor + never-green-when-overdue**

`base = (w or 5) / 50.0` (was `/ 30.0`). After computing `risk`, add:
`if status == "not-started" and hours is not None and hours <= 24: risk = max(risk, 0.5)`
so an overdue/imminent item can't render green. Update any test asserting an exact
risk number. Add:

```python
def test_overdue_assignment_risk_not_green():
    # via build_overview with a fixture assignment 100h overdue, weightPct None
    ...
    a = next(a for a in ov["assignments"] if a["title"] == "<overdue fixture>")
    assert a["risk"] >= 0.5
```

- [ ] **Step 14: `testprepCommand` interpolation**

Exam-row build:

```python
if cslug:
    tp_cmd = f'/mesa:ares-brain-testprep "{_q(slugs.get(cslug, cslug))}"'
    tp_cmds = [{"course": slugs.get(cslug, cslug), "command": tp_cmd}]
else:
    tp_cmds = [{"course": n, "command": f'/mesa:ares-brain-testprep "{_q(n)}"'}
               for n in course_names_for_all_exam]  # from courseNames
    tp_cmd = tp_cmds[0]["command"] if tp_cmds else '/mesa:ares-brain-testprep'
row["testprepCommand"] = tp_cmd
row["testprepCommands"] = tp_cmds
```

Test: a course-scoped exam → `testprepCommand` has the real course name, no `<course>`.

- [ ] **Step 15: `testprepExists` `all()` for program-wide + `parse_assessment` header-required + `_safe` label**

- `testprepExists` for an `["all"]` exam: `all((course_dir(x)/"study").glob("testprep-*.md") for x in slugs)` → change to `all(bool(list((course_dir(x)/"study").glob("testprep-*.md"))) for x in slugs)`.
- `parse_assessment`: if the "Assessment and Evaluation" header is not found (`start is None`), `return []` (no whole-outline scan). Update/confirm tests.
- `_safe(fn, empty)` → `_safe(fn, empty, label="block")`; every call site passes a short label string; the stderr line uses it.

- [ ] **Step 16: run full pytest — green.**

### Part B — assignment enrichment

- [ ] **Step 17: failing tests — `_html_to_text`, `_session_ref`, enrichment fields**

```python
def test_html_to_text_readable():
    html = "<p>Hello</p><ol><li>Do X</li><li>Do Y</li></ol><p>Deadline <strong>29th</strong></p>"
    t = overview._html_to_text(html)
    assert "Hello" in t and "Do X" in t and "Do Y" in t and "29th" in t
    assert "<" not in t and "&nbsp;" not in t

def test_session_ref_from_title():
    assert overview._session_ref("Session 4 Meesho Workbook") == 4
    assert overview._session_ref("Case pre-work") is None

def test_assignment_enrichment_fields(...):
    ov = overview.build_overview(now=NOW)
    a = next(a for a in ov["assignments"] if a["title"].startswith("Session"))
    assert isinstance(a["instructionsText"], str)
    assert isinstance(a["isGroup"], bool)
    assert "cutoffAt" in a and "allowLate" in a
    assert isinstance(a["materials"], list)
    assert a["sessionRef"] is None or isinstance(a["sessionRef"], int)
    assert isinstance(a["prereadPaths"], list)
```

- [ ] **Step 18: run — FAIL.**

- [ ] **Step 19: implement**

```python
import html as _htmllib

_TAG_RE = re.compile(r"<[^>]+>")
_BLOCK_RE = re.compile(r"</(p|li|ol|ul|div|h[1-6]|tr)>|<br\s*/?>", re.I)

def _html_to_text(s: str, cap: int = 2000) -> str:
    if not s:
        return ""
    s = _BLOCK_RE.sub("\n", s)
    s = _TAG_RE.sub("", s)
    s = _htmllib.unescape(s)
    s = re.sub(r"[ \t]+\n", "\n", s)
    s = re.sub(r"\n{3,}", "\n\n", s).strip()
    return s[:cap]

def _session_ref(title: str):
    m = daily_brief._SESSION_RE.search(title or "")
    return int(m.group(1)) if m else None
```

In the assignment loop (and the `today.dueTodayOrTomorrow` producer — that lives in
`daily_brief`; add the same fields there OR post-process in `overview` by joining on
`id`), add:

```python
sref = _session_ref(a.get("title", ""))
cutoff = daily_brief._parse(a.get("cutoffDate"))
mats = [{"title": m.get("title", ""), "kind": m.get("kind", "file")}
        for m in (a.get("materials") or []) if isinstance(m, dict)]
prereads = []
if cslug and sref is not None:
    prereads = _safe(lambda: [r["path"] for r in
                     brain.query(cslug, type="material", session_min=sref, session_max=sref)
                     if r.get("path")], [], label="asg-prereads")
row.update({
    "instructionsText": _html_to_text(a.get("instructions", "")),
    "isGroup": bool(a.get("isGroup")),
    "cutoffAt": cutoff.astimezone().isoformat() if (cutoff and a.get("cutoffDate") != a.get("dueAt")) else None,
    "allowLate": bool(a.get("allowLate")),
    "materials": mats,
    "sessionRef": sref,
    "prereadPaths": prereads,
})
```

`brain.query` is in the import allowlist. Keep it inside `_safe`.

- [ ] **Step 20: `today.changed` → name-resolved list**

Where `today.changed` is set (currently `db.get("changed", {})`), transform:

```python
changed_raw = db.get("changed", {}) if isinstance(db, dict) else {}
changed = [{"courseName": slugs.get(k, k), "courseSlug": k,
            "counts": v if isinstance(v, dict) else {}}
           for k, v in (changed_raw.items() if isinstance(changed_raw, dict) else [])]
```

Test: `ov["today"]["changed"]` is a list; an entry has `courseName` != `courseSlug`
for a known course.

- [ ] **Step 21: run full pytest — green.** Update `test_build_overview_shape` /
      any key-set assertion for the new fields + the `changed` shape.

### Part C — server: `calendar-sync` job + Host guard on the overview GET

- [ ] **Step 22: failing test — `calendar-sync` argv**

`dashboard/server/test/jobs.test.ts`:

```ts
it("calendar-sync job runs `calendar-sync`", () => {
  const spy = vi
    .spyOn(py, "runPython")
    .mockReturnValue({ done: Promise.resolve({ code: 0 }), kill: () => {} });
  startJob({ kind: "calendar-sync" });
  expect(spy.mock.calls[0][0]).toEqual(["calendar-sync"]);
});
```

(match the file's existing spy pattern.)

- [ ] **Step 23: run — FAIL** (type error: `"calendar-sync"` not in `JobKind`).

- [ ] **Step 24: implement**

`lib/jobs.ts`: `JobKind` add `"calendar-sync"`; `argv()` add `case "calendar-sync": return ["calendar-sync"];`.
`index.ts`: `KINDS` array add `"calendar-sync"`. It needs no `course`, so leave it out of the course-required list.

- [ ] **Step 25: failing test — `GET /api/overview` Host guard**

`routes.test.ts`:

```ts
it("rejects GET /api/overview with a foreign Host", async () => {
  const res = await fetch(`${base}/api/overview`, { headers: { Host: "evil.example" } });
  expect(res.status).toBe(403);
});
```

- [ ] **Step 26: run — FAIL** (200 or 503, not 403).

- [ ] **Step 27: implement** — in the `GET /api/overview` handler, call `guardOrigin(req)` first:

```ts
if (match("GET", "/api/overview", method, url)) {
  const bad = guardOrigin(req);
  if (bad) return json(res, 403, { error: bad });
  const r = await runPythonJSON(["overview", "--json"]);
  return r.ok ? json(res, 200, r.data) : json(res, 503, { error: r.error });
}
```

Confirm the existing overview.test.ts still passes (same-origin fetch in tests sets a localhost Host).

- [ ] **Step 28: `runPythonJSON` unit test** — `dashboard/server/test/python.test.ts` (new):

```ts
import { describe, it, expect, vi } from "vitest";
// mock node:child_process spawn to return a fake child emitting canned stdout/close
```

Cases: (a) stdout `"noise\n{\"ok\":1}\n"` + exit 0 → `{ok:true, data:{ok:1}}`;
(b) exit 1 + stderr → `{ok:false, error: <stderr tail>}`;
(c) no `{`-line + exit 0 → `{ok:false}`;
(d) a child that never closes + `timeoutMs: 20` → `{ok:false, error:"timeout"}` and `kill` called.
Mock `venvPython` to a path that `existsSync` returns true for (or mock `existsSync`).

- [ ] **Step 29: run all** — `cd scraper && uv run pytest -q`; `npm run --workspace ares-dashboard test`; `npm run check`. Prettier the touched TS/py-adjacent. Green.

- [ ] **Step 30: commit**

```bash
git add scraper dashboard/server
git commit -m "fix(overview): local-date countdown, malformed-attendance guard, grade matching; + assignment detail, calendar-sync job

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Web shell — theme matrix, summary bar, tab router

**Files:**

- Modify: `dashboard/web/src/index.css`, `src/main.tsx`, `src/api.ts`, `src/App.tsx`
- Create: `src/lib/theme.ts`, `src/lib/useHashRoute.ts`, `src/lib/format.ts`,
  `src/components/{Header,Settings,Tabs,SectionHeader,MetaRow,Rule,StatePill}.tsx`
- Modify: `src/components/JobLog.tsx` (restyle), `src/components/CopyButton.tsx` (keep, verify tokens)
- Delete: `src/components/{KpiStrip,TodayCard,WeekCard,AssignmentsCard,ExamsCard,AttendanceCard,BrainCard,GapsCard,ChatLockCard,RiskBadge}.tsx` + their `test/*` files
- Modify/replace: `test/*` for the deleted set; add `test/{theme,useHashRoute,Header,Settings,Tabs}.test.*`

**Interfaces produced (consumed by T3–T5):**

- `useHashRoute(): { tab: string; params: string[]; go(hash: string): void }` — parses `#tab/seg/seg`.
- `applyTheme(): void` and `getThemePrefs()` / `setThemePrefs({theme, appearance})` from `lib/theme.ts`.
- `<SectionHeader>{title}</SectionHeader>` — uppercase 11px + `border-b-[3px] border-edge` + spacing per spec §3.
- `<Rule vertical? className?/>` — a 1px `bg-rule` divider (the middot replacement).
- `<MetaRow items={ReactNode[]} />` — renders items separated by `<Rule vertical/>`, `gap-3`.
- `<StatePill state="ok"|"soon"|"bad"|"neutral">{label}</StatePill>`.
- `<Header ov onResync busy lastSyncLabel />`, `<Tabs active counts onSelect />`.
- `App.tsx` passes each tab component `{ ov, onJob, busy, go }`.
- `Overview` type in `api.ts` extended with the Task 1 fields (this task owns the type edit since the shell imports it).

- [ ] **Step 1: `Overview` type — add the Task 1 fields**

In `src/api.ts`: add to `OverviewAssignment` and `OverviewDueSoon`:
`instructionsText: string; isGroup: boolean; cutoffAt: string | null; allowLate: boolean; materials: { title: string; kind: string }[]; sessionRef: number | null; prereadPaths: string[];`
Change `OverviewGradeComponent.done` to `boolean | null` (already is — confirm).
Replace `OverviewToday.changed` with:
`changed: { courseName: string; courseSlug: string; counts: Record<string, number> }[];`
Add to `OverviewExam`: `testprepCommands: { course: string; command: string }[];`
Fix latent nullability the review flagged: `OverviewAssignment.id: string | null`,
`OverviewExam.name: string | null`, `OverviewPendingTranscriptItem.videoUrl: string | null`,
`OverviewWeekItem.course: string | null`, `OverviewBrain.corpusBytes/sourceCount: number | null`,
`OverviewBrain.indexStale: boolean | null`.

- [ ] **Step 2: `lib/theme.ts`**

```ts
export type ThemeName = "meadow" | "violet";
export type Appearance = "system" | "light" | "dark";
const TKEY = "ares.theme",
  AKEY = "ares.appearance";
export function getThemePrefs(): { theme: ThemeName; appearance: Appearance } {
  let theme: ThemeName = "meadow",
    appearance: Appearance = "system";
  try {
    const t = localStorage.getItem(TKEY);
    if (t === "meadow" || t === "violet") theme = t;
    const a = localStorage.getItem(AKEY);
    if (a === "system" || a === "light" || a === "dark") appearance = a;
  } catch {
    /* private mode */
  }
  return { theme, appearance };
}
export function setThemePrefs(p: { theme: ThemeName; appearance: Appearance }) {
  try {
    localStorage.setItem(TKEY, p.theme);
    localStorage.setItem(AKEY, p.appearance);
  } catch {}
  applyTheme();
}
export function applyTheme() {
  const { theme, appearance } = getThemePrefs();
  const r = document.documentElement;
  r.dataset.theme = theme; // "meadow" | "violet"
  r.dataset.appearance = appearance; // "system" | "light" | "dark"
}
```

- [ ] **Step 3: `index.css` — token matrix** (spec §4.1/4.2/4.3)

```css
@import "tailwindcss";

@theme {
  /* Meadow light — also generates the bg-*/border-*/text-* utilities */
  --color-edge: #0f8a5f;
  --color-paper: #eafff4;
  --color-card: #ffffff;
  --color-ink: #0e2119;
  --color-cta: #ffd23f;
  --color-accent: #e8590c;
  --color-ok: #2f9e44;
  --color-soon: #f08c00;
  --color-bad: #e03131;
  --radius-nb: 2px;
}
:root {
  --nb-border: 3px;
  --nb-shadow: 4px 4px 0 var(--color-edge);
  --color-rule: color-mix(in srgb, var(--color-edge) 15%, transparent);
  --color-ink-muted: color-mix(in srgb, var(--color-ink) 60%, transparent);
  --color-ink-faint: color-mix(in srgb, var(--color-ink) 40%, transparent);
}

/* ---- Meadow dark ---- */
:root[data-appearance="dark"]:not([data-theme="violet"]),
@media (prefers-color-scheme: dark) {
  :root:not([data-appearance="light"]):not([data-theme="violet"]) { }
}
```

> The `@media` + attribute combination cannot be written as a single selector list.
> Implement it as: a base rule for each (theme, appearance) explicit combo, plus
> one `@media (prefers-color-scheme: dark)` block containing the `:root:not([data-appearance="light"])` variants for both themes. Four dark value-sets total
> (meadow-dark, violet-dark) each written twice (explicit + media). Keep the value
> lists identical between the two copies — a comment says "keep in sync with the
> @media copy". Verify in T6 by toggling appearance and prefers-color-scheme.

```css
body {
  margin: 0;
  background: var(--color-paper);
  color: var(--color-ink);
  color-scheme: light dark;
  font:
    14px/1.5 system-ui,
    sans-serif;
}
```

Muted text in components: `text-[color:var(--color-ink-muted)]`.

- [ ] **Step 4: `main.tsx`** — `import { applyTheme } from "./lib/theme"; applyTheme();` before `createRoot(...).render(<App/>)`. Also add a tiny inline script in `index.html` `<head>` that reads the two localStorage keys and sets `documentElement.dataset` to avoid a flash (guarded try/catch).

- [ ] **Step 5: `lib/useHashRoute.ts`**

```ts
import { useSyncExternalStore, useCallback } from "react";
function read() {
  return window.location.hash.replace(/^#/, "") || "today";
}
export function useHashRoute() {
  const hash = useSyncExternalStore(
    (cb) => {
      window.addEventListener("hashchange", cb);
      return () => window.removeEventListener("hashchange", cb);
    },
    read,
    () => "today",
  );
  const [tab, ...params] = hash.split("/");
  const go = useCallback((h: string) => {
    window.location.hash = h;
  }, []);
  return { tab: tab || "today", params, go };
}
```

Test: set `window.location.hash`, assert `tab`/`params`; `go("assignments/x/1")` updates it.

- [ ] **Step 6: `lib/format.ts`** — `relTime(iso)` ("in 24h", "3d ago"), `fmtDate(isoOrYmd)` ("Wed 9 Sep" — parse `"<ymd>T00:00"` to dodge the UTC trap), `fmtTime(iso)` ("09:30"), `countdown(iso)` ("2d 4h", "overdue"). Port `fmtTime`/`fmtDay` logic from the current `TodayCard`/`WeekCard` before they're deleted. Unit-test each with a fixed input.

- [ ] **Step 7: shared primitives**

`Rule.tsx`: `({vertical, className}) => <div role="separator" className={cn(vertical ? "w-px self-stretch" : "h-px w-full", "bg-[color:var(--color-rule)]", className)} />`
`SectionHeader.tsx`: `<h2 className="mb-4 border-b-[3px] border-edge pb-2 text-[11px] font-bold uppercase tracking-[0.08em]">{children}</h2>`
`MetaRow.tsx`: `({items}) => <div className="flex items-center gap-3 text-[13px]">{items.flatMap((it,i)=> i? [<Rule vertical key={"r"+i}/>, <span key={i}>{it}</span>] : [<span key={i}>{it}</span>])}</div>`
`StatePill.tsx`: CVA over `ok|soon|bad|neutral` → `bg-{ok|soon|bad}` + `text-black` + `border-[3px] border-edge` (neutral = `bg-card`), `rounded-nb px-2 py-0.5 text-[11px] font-bold uppercase`.
Tests: `Rule` renders a separator; `StatePill` maps state→class; `MetaRow` puts a rule between items and none before the first.

- [ ] **Step 8: `Header.tsx`** (summary bar, spec §5.1)

Props `{ ov: Overview; busy: boolean; onResync: () => void; onOpenSettings: () => void }`.
Sticky `top-0 z-20 border-b-[3px] border-edge bg-paper`, `h-14 px-4 md:px-8 flex items-center gap-4`.

- wordmark tag (`bg-cta border-[3px] border-edge rounded-nb px-2 py-0.5 text-[12px] font-bold`) + `fmtDate(ov.date)` + `ov.term` in a `MetaRow`.
- chips (`hidden md:flex`): a `<Chip label value tint?>` — `dueThisWeek`, `attendanceNow→attendanceBestCase%`, `nextExamInDays==null? "—" : exam Nd`, `brainReady/courseCount`. Tint `soon` per spec §5.1 thresholds.
- right (`ml-auto flex items-center gap-3`): `updated {relTime(ov.generatedAt)}` muted; `<Button variant="default" onClick={onResync} disabled={busy}>{busy ? "syncing…" : "⟲ Re-sync"}</Button>`; gear `<Button variant="neutral" size="icon" onClick={onOpenSettings} aria-label="Settings">⚙</Button>`.
- a `useEffect` binding `keydown` "r" → `onResync()` when `document.activeElement` is not an input/textarea and `!busy`.
  Test: renders chips; chip tint class appears when `nextExamInDays=6`; Re-sync disabled + "syncing…" when `busy`; clicking Re-sync calls `onResync`; "r" key calls it.

- [ ] **Step 9: `Settings.tsx`** (spec §5.2)

Props `{ open: boolean; onClose: () => void }`. A fixed overlay panel (`bg-card border-[3px] border-edge shadow-[var(--nb-shadow)] rounded-nb`), right sheet on mobile.

- Theme: two swatch buttons `meadow` / `violet`, each shows 4 mini colour blocks (hard-code the hex from spec §4.1/4.2 light for the preview). Selected = pressed state.
- Appearance: segmented `System | Light | Dark`.
- On change: `setThemePrefs({theme, appearance})` (re-applies live).
- Read-only list: attendance min 75, chat unlock 15, port 4319 (static text; note "set via env").
- `Esc` / backdrop click → `onClose`.
  Test: clicking "violet" writes `localStorage["ares.theme"]="violet"` and sets `documentElement.dataset.theme`; segmented "Dark" writes appearance and sets dataset; re-mount reflects stored values.

- [ ] **Step 10: `Tabs.tsx`** (spec §5.3)

Props `{ active: string; counts: { assignments: number; gaps: number }; onSelect: (tab: string) => void }`.
Sticky `top-14 z-10 bg-paper border-b border-[color:var(--color-rule)] flex gap-1 px-4 md:px-8 overflow-x-auto`.
Each tab a button: active → `bg-card border-[3px] border-edge translate-y-[2px]` (no shadow); inactive → `border-[3px] border-transparent hover:bg-card/60`. `Assignments`/`Gaps` show a count badge (`bg-edge text-paper rounded-nb px-1 text-[11px]`) when `> 0`.
Test: active tab has the pressed classes; clicking a tab calls `onSelect` with its id; a count badge shows when `counts.gaps=9`.

- [ ] **Step 11: `JobLog.tsx` restyle** — same behaviour, swap the dead `--color-surface-*`/`--color-ink-soft`/`green-500`/`red-500` for `bg-card border-[3px] border-edge` + `var(--color-ok)`/`var(--color-bad)` for the status dot + `var(--color-ink-muted)` for the pre. Keep the autoscroll `useEffect`.

- [ ] **Step 12: `App.tsx` shell**

```tsx
export function App() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [err, setErr] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const stop = useRef<(() => void) | undefined>(undefined);
  const { tab, params, go } = useHashRoute();

  const refresh = () =>
    getOverview()
      .then((o) => {
        setOv(o);
        setErr("");
      })
      .catch((e) => setErr(String(e)));
  useEffect(() => {
    refresh();
    api.getState().then((s) => setJob(s.job));
  }, []);
  useEffect(() => {
    const t = setInterval(() => api.getState().then((s) => setJob(s.job)), 3000);
    return () => clearInterval(t);
  }, []);
  const busy = job?.status === "running";

  async function onJob(kind: string, opts: Record<string, string> = {}) {
    try {
      const r = await api.startJob({ kind, ...opts });
      if (!r.jobId) {
        setLines((p) => [...p, `! ${r.error}`]);
        return;
      }
      setLines([]);
      stop.current?.();
      stop.current = api.streamLog(
        r.jobId,
        (l) => setLines((p) => [...p, l]),
        () => {
          api.getState().then((s) => setJob(s.job));
          refresh();
        },
        () => {
          api.getState().then((s) => setJob(s.job));
        },
      );
    } catch (e) {
      setLines((p) => [...p, `! ${e}`]);
    }
  }

  if (!ov && err) return <ErrorCard message={err} onRetry={refresh} />; // full-page, only pre-first-load
  if (!ov) return <div className="mx-auto max-w-[1400px] p-8">loading…</div>;

  const counts = {
    assignments: ov.assignments.length,
    gaps:
      ov.gaps.pendingTranscripts.length +
      ov.gaps.missingBooks.length +
      (ov.gaps.scrapeStale ? 1 : 0),
  };

  return (
    <div className="mx-auto max-w-[1400px] px-4 pb-8 md:px-8">
      <Header
        ov={ov}
        busy={!!busy}
        onResync={() => onJob("sync")}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <Tabs active={tab} counts={counts} onSelect={(t) => go(t)} />
      {err && ov && <StaleBanner onRetry={refresh} />} {/* non-blocking */}
      <main className="py-6">
        {tab === "today" && <TodayTab ov={ov} go={go} />}
        {tab === "assignments" && <AssignmentsTab ov={ov} params={params} go={go} />}
        {tab === "attendance" && <AttendanceTab ov={ov} />}
        {tab === "exams" && <ExamsTab ov={ov} />}
        {tab === "brain" && <BrainTab ov={ov} busy={!!busy} onJob={onJob} />}
        {tab === "gaps" && <GapsTab ov={ov} busy={!!busy} onJob={onJob} />}
      </main>
      {(job || lines.length > 0) && <JobLog job={job} lines={lines} />}
      <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
```

T2 ships placeholder tab components (`export function TodayTab() { return <SectionHeader>Today</SectionHeader>; }` etc.) so the app compiles; T3–T5 replace them. `ErrorCard` / `StaleBanner` are small local components (neubrutalist `bg-bad`/`bg-soon` panels).

- [ ] **Step 13: delete the superseded components + tests**; fix any dangling import.

- [ ] **Step 14: run** — `npm run --workspace ares-dashboard-web build && check && test`; `npm run --workspace ares-dashboard-server test`; `npm run check`. Prettier. Green.

- [ ] **Step 15: commit**

```bash
git add dashboard/web
git commit -m "feat(dashboard): tabbed shell — summary bar, theme picker, hash routing

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Today tab

**Files:** Create `src/components/today/{ClassTimeline,DueNow,ChangedFeed}.tsx` + `src/components/TodayTab.tsx` (replace the T2 placeholder) + `test/*`. Consumes `ov.today`, `lib/format`, the T2 primitives, `go`.

- [ ] **Step 1: `TodayTab.tsx`** — `grid gap-6 lg:grid-cols-[1.15fr_1fr]`; left `<ClassTimeline classes={ov.today.classes}/>`; right `<div className="space-y-6"><DueNow items={ov.today.dueTodayOrTomorrow} assignments={ov.assignments} go={go}/><ChangedFeed changed={ov.today.changed} scrapeAgeHours={ov.scrapeAgeHours}/></div>`. If `classes` empty AND `dueTodayOrTomorrow` empty AND `changed` empty → a single `<EmptyToday nextClass=.../>` panel.

- [ ] **Step 2: `ClassTimeline.tsx`** — a `<SectionHeader>Today</SectionHeader>` then a vertical rail (`border-l-[3px] border-edge pl-4 space-y-4`). Each class: a dot (`absolute -left-[7px]` circle, fill = `ok` if now-between-start-end, hollow if future, muted-fill if past), `fmtTime(start)–fmtTime(end)` bold, course, then `<MetaRow items={[room, instructor].filter(Boolean)} />` (the Rule replaces the `·`), a `pre-read` `accent` chip when `prereadPaths.length` (title attr = "session N pre-read"). Tests: renders 3 classes; a class spanning `now` gets the "now" dot class; `MetaRow` shows a rule between room and instructor; no room → no leading rule.

- [ ] **Step 3: `DueNow.tsx`** — `<SectionHeader>Due now</SectionHeader>`, `divide-y divide-[color:var(--color-rule)]`. Row: title, course muted, right side `relTime(dueAt)` (or `<StatePill state="soon">soon</StatePill>` when `hoursAway != null && hoursAway < 6`) + an `Open →` button (`accent`) that, if `assignments.find(a => a.id === item.id)`, calls `go("assignments/" + slug + "/" + id)`, else `go("assignments")`. `submitted` rows: `line-through opacity-60` + an `ok` check, sorted last. Test: submitted sorts last + struck; `Open →` on a matched item navigates to the focused hash; `< 6h` shows the soon pill.

- [ ] **Step 4: `ChangedFeed.tsx`** — `<SectionHeader>Since last scrape</SectionHeader>` + muted sub `updated {relTime? or "N h ago"}`. One row per `changed[]` entry: `courseName` then the `counts` as small `StatePill state="neutral"` chips (`4 announcements`, `1 material`) — never `·` text. Empty → render nothing (parent handles the all-empty case). Test: a row shows the course _name_ not slug; counts render as chips.

- [ ] **Step 5:** build + check + test + `npm run check`; prettier; commit `feat(dashboard): Today tab`.

---

## Task 4: Assignments — list, grade picture, focused page

**Files:** Create `src/components/assignments/{AssignmentsTab,GradePicture,AssignmentPage,AssignmentChecklist}.tsx` + `test/*`. Consumes `ov.assignments`, `ov.gradePicture`, `lib/format`, `lib/theme` (no), primitives, `params`, `go`, `CopyButton`.

- [ ] **Step 1: `AssignmentsTab.tsx` routing** — if `params.length >= 2` render `<AssignmentPage ov={ov} slug={params[0]} id={params[1]} go={go}/>`, else the list view.

- [ ] **Step 2: list view** — header `<MetaRow items={["{n} open", "{m} due this week", "worst: {title} ({weight})"]} />` (compute `m` = assignments with `hoursAway != null && hoursAway <= 168`; worst = `assignments[0]`). List `divide-y divide-[color:var(--color-rule)]`, each row a button (`go("assignments/{slug}/{id}")` when `id`): status square (`border-[3px] border-edge` + fill `bad`/`soon`/`ok` by status), title `font-medium`, course muted, right `<MetaRow items={[weight ?? "ungraded", dueLabel, "Open →"]} />` where `dueLabel` = `countdown(dueAt)` in `bad` text when overdue/`<48h`. Ungraded/club rows `opacity-80`. Below: `<div className="mt-6 border-t border-[color:var(--color-rule)] pt-6"><GradePicture rows={ov.gradePicture}/></div>`.
      Test: rows in `risk` order; `weightPct:null` → "ungraded"; clicking a row sets the focused hash; overdue due-label has the `bad` class.

- [ ] **Step 3: `GradePicture.tsx`** — `<SectionHeader>Grade picture</SectionHeader>`, per course: course name, a bar (`h-3 border-[3px] border-edge rounded-nb` with a filled `bg-edge` segment `width: {100 - aheadPct}%`), the `summary` line muted beneath. Test: bar fill width matches `100 - aheadPct`; summary text rendered.

- [ ] **Step 4: `AssignmentPage.tsx`** (spec §6.2 focused page) — find `a = ov.assignments.find(x => x.courseSlug === slug && x.id === id)`; if missing → "assignment not found" + back link.
  - `← all assignments` button → `go("assignments")`.
  - `<h1>` title, course, badge row of `<StatePill>`: `weight% or "ungraded"`, `isGroup ? "group" : "solo"`, `submissionType`, `status`.
  - **Deadline** panel (`<Panel>` = `bg-card border-[3px] border-edge rounded-nb p-4 md:p-6`): `due {fmtDate}{fmtTime}`; `cutoffAt` → `hard cutoff {…}`; `allowLate ? "late allowed" : "no late submissions"`; `countdown(dueAt)` big, `bad` under 24h.
  - **What's being asked** panel: `instructionsText` split on `\n\n` into `<p>`s; empty → the fallback line.
  - **Attached materials** panel: list `title` + `<StatePill state="neutral">{kind}</StatePill>`; footnote about the Resources tab. Hide panel when `materials` empty.
  - **Maps to** panel (hide when `sessionRef == null`): `Session {sessionRef}`, `prereadPaths` as `<li>` (plain text paths; no links to files — the server doesn't serve them), a `<CopyButton value={'/mesa:ares-brain-course-brief "' + course + '"'} label="Brief this session"/>`.
  - **Start in Claude** panel: `<CopyButton value={a.helpCommand} label="Start in Claude"/>` (yellow, large) + muted "paste in Claude Code".
  - **Checklist** panel: `<AssignmentChecklist id={id}/>`.
    Test: renders instructions paragraphs; `CopyButton` carries `helpCommand`; missing assignment → not-found; back button navigates.

- [ ] **Step 5: `AssignmentChecklist.tsx`** — state `{ text: string; done: boolean }[]` from `localStorage["ares.checklist." + id]` (try/catch, default `[]`); a text input + Enter adds; checkbox toggles; a `×` deletes; every mutation writes back. A `status` segmented control `not started | started | submitted` persisted to `ares.localstatus.<id>` with a muted note "local only — not sent to the LMS". Test (mock `localStorage`): add persists; reload reads back; toggle writes `done:true`; status control persists.

- [ ] **Step 6:** build + check + test + `npm run check`; prettier; commit `feat(dashboard): Assignments tab + focused assignment page`.

---

## Task 5: Attendance, Exams, Brain, Gaps tabs

**Files:** Create `src/components/{AttendanceTab,ExamsTab,BrainTab,GapsTab}.tsx` (replace T2 placeholders) + `test/*`. Delete `src/components/ui/{skeleton,table,card}.tsx` **if** still unimported after this task, and drop `lucide-react` from `package.json` if unused. Consumes `ov.attendance`, `ov.attendanceMin`, `ov.exams`, `ov.brain`, `ov.kpis`, `ov.chatUnlockAt`, `ov.gaps`, `onJob`, `busy`, `upload` from `api.ts`.

- [ ] **Step 1: `AttendanceTab.tsx`** (spec §6.3) — top `<MetaRow items={["attended {X} of {Y}", "{Z}% overall", "best case {W}%"]} />` (compute X/Y/Z/W by summing `attendance[]`), muted `assumes ≥ {attendanceMin}% (ARES_BRAIN_ATTENDANCE_MIN)`. A `<table className="w-full">`: `thead` row `border-b-[3px] border-edge` (Course / Now / Held / Left / Best case mid–end / Floor / State); `tbody` `divide-y divide-[color:var(--color-rule)]`. Row bg = state tint via inline `style={{ background: "color-mix(in srgb, var(--color-" + tint + ") 8%, var(--color-card))" }}` where tint = `ok|soon|bad` for `ok|watch|risk`. State cell = `<StatePill>` + the `note` as a muted second line on watch/risk. Sort state: default `risk desc`; a clickable `Now` header toggles numeric sort. Test: at-risk row has a bad-tint style + shows note; sort toggle reorders; header rule present.

- [ ] **Step 2: `ExamsTab.tsx`** (spec §6.4) — `space-y-6`; card per exam sorted by `date`. Title (`name ?? "Exam"`), `<MetaRow items={[fmtDate(date), countdown]} />`, scope = `courseNames.length ? courseNames.join(", ") : "all courses"`. `<StatePill state={brainReady ? "ok" : "bad"}>` + `<StatePill state={testprepExists ? "ok" : "neutral"}>{testprepExists ? "practice set" : "no practice set"}</StatePill>`. Actions: for each entry in `testprepCommands` a `<CopyButton value={cmd} label={"Practice set" + (testprepCommands.length > 1 ? " · " + course : "")}/>`; `<CopyButton>` for `course-brief` per course when `!brainReady`. Test: countdown shows; a course-scoped exam's practice-set button carries the interpolated command (no `<course>`); an `all` exam renders one button per course.

- [ ] **Step 3: `BrainTab.tsx`** (spec §6.5) — header `{brainReady} of {courseCount} course brains ready — chat unlocks at {chatUnlockAt}` + `<Progress value={Math.round(brainReady / chatUnlockAt * 100)}/>`. Table: Course / State pill (`ready`→ok, `stale`→soon, `not-built`→bad) / Why (`reason`, muted) / Corpus (`corpusBytes != null ? Math.round(corpusBytes/1024)+" KB" : "—"`) / Actions (`<Button onClick={() => onJob("ingest", { course: courseSlug })} disabled={busy}>Ingest</Button>` when state != "ready"; `<CopyButton value={buildCommand} label="Build guide"/>`). Sort `not-built` → `stale` → `ready`. Test: sort order; ingest button hidden for ready rows; ingest click calls `onJob("ingest", {course})`; corpus `—` when null.

- [ ] **Step 4: `GapsTab.tsx`** (spec §6.6) — three `<section>`s, each hidden when its data is empty; all empty → "Nothing outstanding."
  - Transcripts: per `pendingTranscripts[]` group — `<MetaRow items={["{count} recordings", courseName]} />` + `<Button onClick={() => onJob("transcribe", { course: courseSlug })} disabled={busy}>Transcribe all</Button>`; a `<details>` lists `items[]` (`title`, `recordedOn`).
  - Missing books: keyed by `title` — `title` — `author`, muted `mentioned in {mentionedIn.map(slug→name).join(", ")}`, a PDF `<input type="file" accept="application/pdf" multiple>` (dashed `border-[3px] border-dashed border-edge rounded-nb p-2`) → `upload(mentionedIn[0], "book", files)` → render `written`/`rejected`. Hint: `drop a PDF here, or put it in courses/{slug}/inbox/books/`.
  - Stale: `scrape is {Math.round(scrapeAgeHours/24)} days old` + `<Button onClick={() => onJob("sync")}>Re-sync</Button>`; `attendanceStale` → a muted note.
    Test: a Transcribe button per group; click → `onJob("transcribe", {course})`; `scrapeStale:false` hides the stale row; upload input → `upload` called with `(mentionedIn[0], "book", files)`; book messages keyed by title survive a re-render with a reordered list.

- [ ] **Step 5: cleanup** — grep `src` for imports of `ui/skeleton`, `ui/table`, `ui/card`; delete the unused ones and their nonexistent tests; `grep -r "lucide-react" src` → if zero, remove from `package.json` deps and re-run `npm install`.

- [ ] **Step 6:** build + check + test + `npm run check`; prettier; commit `feat(dashboard): Attendance, Exams, Brain, Gaps tabs`.

---

## Task 6: Glue, live run, docs, merge

**Files:** Modify `README.md`, `docs/lms-api.md`; possibly `.github/workflows/ci.yml` (only if a step is missing); `.superpowers/sdd/progress.md`.

- [ ] **Step 1: full green** — from a clean tree: `cd scraper && uv run pytest -q`; `npm ci` (verify the lockfile reifies); `npm run --workspace ares-dashboard test`; `npm run check` (exit 0). Fix any stragglers.

- [ ] **Step 2: live run** — `npm run --workspace ares-dashboard build && npm run --workspace ares-dashboard-server start`, open `http://127.0.0.1:4319`. Walk every tab. Open a focused assignment page. Open Settings, switch `Meadow`↔`Ultraviolet` and `System/Light/Dark` — confirm tokens swap with no flash and both themes are readable in both appearances (check `ink`-on-`paper`/`card` and black-on-`cta`/`ok`/`bad`). Trigger a `sync` from Re-sync and a `transcribe` from Gaps — confirm the job strip streams and the overview refreshes. Screenshot: Today (Meadow light), Today (Ultraviolet dark), a focused assignment page, Attendance. Send the screenshots to the user.

- [ ] **Step 3: `README.md`** — rewrite the "Dashboard" section: the tabbed outcome view, what each tab answers, the deterministic-job vs copy-command split, the theme picker + `ARES_BRAIN_*` env vars, how to start it (`npm run dashboard` dev / `npm run dashboard:build` + `... start` / `/mesa:ares-brain-dashboard`), how to refresh (Re-sync button / `r`).

- [ ] **Step 4: `docs/lms-api.md`** — append `## G dashboard redesign — live run <date>` with what was verified (tabs, themes, jobs) and anything not (e.g. yt-dlp egress still blocks `transcribe` end-to-end on this machine).

- [ ] **Step 5: commit** `docs(dashboard): README + lms-api for the redesigned dashboard`.

- [ ] **Step 6: whole-branch review** — dispatch the code-reviewer (opus) over `main..HEAD` of `g-dashboard` with `scripts/review-package $(git merge-base main HEAD) HEAD`. Fix Critical/Important in one fix wave. Record Minors in `.superpowers/sdd/progress.md`.

- [ ] **Step 7: merge** — `superpowers:finishing-a-development-branch`: `git checkout main && git merge --no-ff g-dashboard`, run the full suite on `main`, push if the user approves.

- [ ] **Step 8:** refresh the installed plugin cache (`claude plugin uninstall/marketplace update/install`), update memory `ares-brain-project.md` with the G outcome.

---

## Self-Review

**Spec coverage:** shell §5 → T2; Today §6.1 → T3; Assignments + focused page §6.2 → T4; Attendance/Exams/Brain/Gaps §6.3–6.6 → T5; data enrichment §7 → T1 Part B; must-fix + folded follow-ups §8 → T1 Part A/C; themes §4 → T2 Step 3/9; spacing/divider/colour Global Constraints → every component task + the T6 live-run contrast check; testing §10 → each task's test steps; out-of-scope §11 → unchanged (checklist/status are localStorage-only, no download proxy, no LLM). All covered.

**Placeholder scan:** the CSS §4.3 dark-selector matrix is described, not code-complete, with an explicit instruction (four value-sets, each written twice, kept in sync, verified in T6) — this is a known CSS limitation, not hand-waving. Fixture extensions in T1 Steps 9/13/17 name what to add. No `TODO`/`TBD`.

**Type consistency:** `Overview` fields added in T1 Part B are typed in T2 Step 1 with the same names (`instructionsText`, `sessionRef`, `materials`, `changed` list shape, `testprepCommands`). `onJob(kind, opts)` → `api.startJob({kind, ...opts})` → server `KINDS` — `sync`/`ingest`/`transcribe`/`calendar-sync` all present after T1 Part C. `useHashRoute` return shape (`{tab, params, go}`) matches every consumer (`App`, `AssignmentsTab`). `go` signature (`(hash: string) => void`) consistent.
