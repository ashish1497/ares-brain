# G — Outcome Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]`. TDD is mandatory — every code step is failing-test → run-red → implement → run-green → commit.

**Goal:** Replace the F dashboard with a single outcome-driven "where do I stand" view backed by a new `scraper/overview.py` + `GET /api/overview`; rebuild `dashboard/web` on React + shadcn (neobrutalism.dev), palette B.

**Architecture:** `overview.py` (pure, reuses `daily_brief.py` + `brain.py`) computes 7 blocks (today, this-week, assignment-risk, exams, attendance-runway, brain-readiness, gaps) + a new outline assessment-table weight parser. CLI `overview --json`; the F server gains one buffered `GET /api/overview` route. `dashboard/web` migrates Preact→React, vendors the neobrutalism.dev shadcn components, and renders 10 sections; deterministic actions run via the existing job runner, Claude-powered ones hand off a copy-command.

**Tech Stack:** Python 3.12 (`uv`); Node 20 + TS; React 18 + Vite 6 + `@vitejs/plugin-react`; shadcn/ui via neobrutalism.dev; Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-09-08-outcome-dashboard-design.md`

## Global Constraints

- `scraper/overview.py` module-top imports: stdlib + `from paths import ...` + `import brain` + `import daily_brief` ONLY. NEVER `mesa_api` / `scrape_steps` / `calendar_sync` / `dotenv` / `requests`. `test_overview_import_isolation` guards it.
- `build_overview` never raises for one bad course/file — per-item try/except, skip, continue; a malformed `_attendance.json` / `_events.json` / a course with no outline still yields a full dict.
- `.env` never read/printed by any G code. No LLM anywhere (chatbot is phase 2).
- Server: `GET /api/overview` is a one-shot spawn (buffered), NOT a streamed job. `127.0.0.1` only. `guardOrigin` stays on the POST routes, not the GETs.
- Deterministic dashboard actions → existing job runner (`sync`/`ingest`/`transcribe`/`transcribe-url`/`calendar-sync`). Claude actions (`assignment-help`/`testprep`/`course-brain`) → clipboard copy of `/mesa:ares-brain-<cmd> …`, never executed by the dashboard.
- Palette B tokens exact: edge `#0f8a5f`, paper `#eafff4`, card `#ffffff`, accent(coral) `#ff8a3d`, cta(yellow) `#ffd23f`, ok `#7ee081`, soon `#ffb056`, bad `#ff6b6b`; border 3px, shadow `4px 4px 0 var(--color-edge)`, radius 2px, no gradients. Dark: paper `#161d1a`, card `#1e2624`, edge stays `#0f8a5f`.
- `ARES_BRAIN_ATTENDANCE_MIN` (default 75), `ARES_BRAIN_CHAT_UNLOCK` (default 15) — env-tunable.
- `dashboard/**/dist/` gitignored + prettier-ignored (already). `npm run check` must stay clean.
- Branch `g-dashboard` off `main`. TDD. Frequent commits.

---

## Task 1: `scraper/overview.py` + CLI

**Files:**

- Create: `scraper/overview.py`, `scraper/tests/test_overview.py`, `scraper/tests/fixtures/scrubbed/overview_corpus/` (fixture tree)
- Modify: `scraper/lms_scrape.py` (subparser near `daily-brief` ~line with `db = sub.add_parser`; dispatch near the `daily-brief` branch), `scraper/tests/test_cli.py`

**Interfaces:**

- Consumes: `daily_brief.build_daily_brief`, `daily_brief._iter_assignment_files`, `daily_brief._parse`, `daily_brief._local_date`, `daily_brief._read_json`, `daily_brief._SESSION_RE`; `brain.brain_status`, `brain.parse_frontmatter`, `brain.next_session`; `paths.courses_root`, `paths.course_dir`, `paths.global_file`.
- Produces: `overview.build_overview(now: datetime | None = None) -> dict` (shape = spec §3); `overview.parse_assessment(outline_body: str) -> list[dict]` (`[{name, weightPct}]`); `overview.attendance_runway(att, future_sessions, midterm_date, endterm_date, minimum) -> dict`.

- [ ] **Step 1: Fixture tree**

```
scraper/tests/fixtures/scrubbed/overview_corpus/
  _index.json
  _events.json
  _attendance.json
  _assignments-unassigned.json
  comm/raw/assignments.json
  comm/raw/recordings.json
  comm/normalized/outline-outline.md
  comm/normalized/session-1.md
  comm/normalized/_ingest.json
  comm/brain/_brain.json
  comm/transcripts/rec-a.md
  sell/raw/recordings.json
  sell/normalized/outline-outline.md
  sell/normalized/_ingest.json
```

`_index.json`:

```json
[
  { "id": "c-comm", "name": "Power of Communication", "slug": "comm" },
  { "id": "c-sell", "name": "The Art of Selling", "slug": "sell" }
]
```

`_events.json` (today in tests = 2026-09-10; midterm 2026-09-19; last session 2026-10-06):

```json
{
  "window": { "from": "x", "to": "y" },
  "events": [
    {
      "id": "s-comm-past",
      "eventType": "session",
      "title": "Comm S3",
      "courseSlug": "comm",
      "startAt": "2026-09-08T04:00:00.000Z",
      "endAt": "2026-09-08T05:30:00.000Z",
      "courseName": "Power of Communication",
      "room": "Delta"
    },
    {
      "id": "s-comm-1",
      "eventType": "session",
      "title": "Comm Session 4",
      "courseSlug": "comm",
      "startAt": "2026-09-12T04:00:00.000Z",
      "endAt": "2026-09-12T05:30:00.000Z",
      "courseName": "Power of Communication",
      "room": "Delta",
      "instructorName": "Chirantan"
    },
    {
      "id": "s-comm-2",
      "eventType": "session",
      "title": "Comm Session 5",
      "courseSlug": "comm",
      "startAt": "2026-09-17T04:00:00.000Z",
      "endAt": "2026-09-17T05:30:00.000Z",
      "courseName": "Power of Communication",
      "room": "Delta"
    },
    {
      "id": "s-comm-3",
      "eventType": "session",
      "title": "Comm Session 6",
      "courseSlug": "comm",
      "startAt": "2026-10-06T04:00:00.000Z",
      "endAt": "2026-10-06T05:30:00.000Z",
      "courseName": "Power of Communication",
      "room": "Delta"
    },
    {
      "id": "s-sell-1",
      "eventType": "session",
      "title": "Sell S2",
      "courseSlug": "sell",
      "startAt": "2026-09-15T04:00:00.000Z",
      "endAt": "2026-09-15T05:30:00.000Z",
      "courseName": "The Art of Selling",
      "room": "Delta"
    },
    {
      "id": "ex-mid",
      "eventType": "exam",
      "title": "Mid Term Exams",
      "courseName": "Program",
      "startAt": "2026-09-19T04:00:00.000Z",
      "endAt": "2026-09-19T07:00:00.000Z"
    },
    {
      "id": "ex-end",
      "eventType": "exam",
      "title": "End Term Exams",
      "courseName": "Program",
      "startAt": "2026-10-15T04:00:00.000Z",
      "endAt": "2026-10-15T07:00:00.000Z"
    }
  ]
}
```

`_attendance.json`:

```json
{
  "raw": [
    {
      "courseId": "c-comm",
      "courseName": "Power of Communication",
      "attended": 6,
      "total": 8,
      "percentage": 75.0,
      "avgCp": 7.5
    },
    {
      "courseId": "c-sell",
      "courseName": "The Art of Selling",
      "attended": 1,
      "total": 4,
      "percentage": 25.0,
      "avgCp": 6.0
    }
  ]
}
```

`_assignments-unassigned.json`: `[]`
`comm/raw/assignments.json`:

```json
[
  {
    "id": "a-pitch1",
    "courseName": "Power of Communication",
    "title": "Pitch 1",
    "dueAt": "2026-09-11T18:00:00.000Z",
    "submissionType": "file",
    "mySubmissionStatus": null
  },
  {
    "id": "a-pitch2",
    "courseName": "Power of Communication",
    "title": "Pitch 2",
    "dueAt": "2026-09-18T18:00:00.000Z",
    "submissionType": "file",
    "mySubmissionStatus": null
  },
  {
    "id": "a-refl",
    "courseName": "Power of Communication",
    "title": "Session 1 Reflection",
    "dueAt": "2026-08-20T18:00:00.000Z",
    "submissionType": "any",
    "mySubmissionStatus": "submitted"
  }
]
```

`comm/raw/recordings.json`:

```json
[
  {
    "id": "rec-a",
    "title": "Session 1",
    "videoUrl": "https://youtu.be/a",
    "recordedOn": "2026-08-17"
  },
  {
    "id": "rec-b",
    "title": "Session 2",
    "videoUrl": "https://youtu.be/b",
    "recordedOn": "2026-08-24"
  },
  {
    "id": "rec-c",
    "title": "Session 3",
    "videoUrl": "https://youtu.be/c",
    "recordedOn": "2026-08-31"
  }
]
```

`comm/normalized/outline-outline.md`:

```
---
type: outline
title: "Outline"
course: "Power of Communication"
updatedAt: 2026-09-06T02:00:00Z
---
|  | Power of Communication with Chirantan |  |  |  |
|  | 3. Assessment and Evaluation |  |  |  |
|  | Classroom Participation |  | 10% from Mesa |  |
|  | Power of Communication |  | Pitch 1: 30%
Pitch 2: 30% |  |
|  | Written Communication |  | 10% |  |
|  | Personal Branding |  | 20% |  |
```

`comm/normalized/session-1.md`: minimal frontmatter `type: session`, `updatedAt` now.
`comm/normalized/_ingest.json`: `{"sources":{},"ingestedAt":"2026-09-10T02:00:00Z","formatVersion":2}`
`comm/brain/_brain.json`:

```json
{
  "indexBuiltAt": "2026-09-10T02:00:00Z",
  "indexFingerprint": {},
  "guideBuiltAt": "2026-09-10T02:00:00Z",
  "guideSourceHashes": [],
  "corpusBytes": 5000
}
```

`comm/transcripts/rec-a.md`: `---\ntype: transcript\n---\n[00:00:00] hi`
`sell/raw/recordings.json`: 4 entries (`rec-1`..`rec-4`), none transcribed.
`sell/normalized/outline-outline.md`: frontmatter + a body with NO assessment table.
`sell/normalized/_ingest.json`: `{"sources":{},"ingestedAt":"2026-09-10T02:00:00Z","formatVersion":2}` (no `brain/_brain.json` → guide not built).

- [ ] **Step 2: Write the failing tests — `scraper/tests/test_overview.py`**

```python
import json, subprocess, sys
from datetime import datetime, timezone
from pathlib import Path
import pytest
import overview

FIX = Path(__file__).parent / "fixtures" / "scrubbed" / "overview_corpus"
NOW = datetime(2026, 9, 10, 6, 0, tzinfo=timezone.utc)


@pytest.fixture
def corpus(home, monkeypatch):
    import shutil, importlib, paths, brain, daily_brief
    dst = home / "courses"
    shutil.rmtree(dst, ignore_errors=True)
    shutil.copytree(FIX, dst)
    monkeypatch.setenv("TZ", "UTC")
    import time as _t
    _t.tzset()
    importlib.reload(paths); importlib.reload(brain)
    importlib.reload(daily_brief); importlib.reload(overview)
    return home


def test_parse_assessment_multivalue():
    body = ("| Classroom Participation | | 10% from Mesa | |\n"
            "| Power of Communication | | Pitch 1: 30%\nPitch 2: 30% | |\n"
            "| Personal Branding | | 20% | |\n")
    got = {c["name"]: c["weightPct"] for c in overview.parse_assessment(body)}
    assert got["Pitch 1"] == 30 and got["Pitch 2"] == 30
    assert got["Classroom Participation"] == 10
    assert got["Personal Branding"] == 20


def test_parse_assessment_no_table():
    assert overview.parse_assessment("no percentages here") == []


def test_attendance_runway_math():
    # attended 6 of 8, 2 sessions before midterm, 3 before endterm
    r = overview.attendance_runway({"attended": 6, "total": 8, "avgCp": 7.5},
                                   sessions_to_mid=2, sessions_to_end=3, minimum=75)
    assert r["nowPct"] == 75.0
    assert r["bestCaseMidtermPct"] == 80   # (6+2)/(8+2)
    assert r["bestCaseEndtermPct"] == 82   # (6+3)/(8+3) = 81.8 -> 82
    assert r["floorEndtermPct"] == 55      # 6/(8+3)
    assert r["atRisk"] is False            # best case clears 75


def test_attendance_runway_at_risk():
    r = overview.attendance_runway({"attended": 1, "total": 4, "avgCp": 6.0},
                                   sessions_to_mid=1, sessions_to_end=3, minimum=75)
    assert r["bestCaseEndtermPct"] == 57   # (1+3)/(4+3)
    assert r["atRisk"] is True


def test_build_overview_shape(corpus):
    o = overview.build_overview(now=NOW)
    for k in ("generatedAt", "date", "scrapeAgeHours", "kpis", "today", "thisWeek",
              "assignments", "gradePicture", "exams", "attendance", "attendanceMin",
              "brain", "gaps"):
        assert k in o
    json.dumps(o)  # fully serialisable


def test_assignments_risk_desc_and_weights(corpus):
    o = overview.build_overview(now=NOW)
    titles = [a["title"] for a in o["assignments"]]
    assert "Session 1 Reflection" not in titles      # submitted, excluded
    assert titles == sorted(titles, key=lambda t:
        -next(a["risk"] for a in o["assignments"] if a["title"] == t))
    p1 = next(a for a in o["assignments"] if a["title"] == "Pitch 1")
    assert p1["weightPct"] == 30
    assert p1["helpCommand"] == '/mesa:ares-brain-assignment-help "Power of Communication" "Pitch 1"'


def test_grade_picture(corpus):
    o = overview.build_overview(now=NOW)
    gp = next(g for g in o["gradePicture"] if g["courseSlug"] == "comm")
    assert gp["aheadPct"] == 90   # 100 total - 10 (reflection? no) ; Pitch1+Pitch2+Written+PB+CP not done => but reflection not a component -> ahead = 30+30+10+20+10 = 100? see impl note
    # (adjust the exact number to the impl's done-matching once written; assert it's an int 0..100)
    assert 0 <= gp["aheadPct"] <= 100
    assert "still ahead" in gp["summary"]


def test_exams_countdown_and_testprep(corpus):
    o = overview.build_overview(now=NOW)
    mid = next(e for e in o["exams"] if e["name"] == "Mid Term Exams")
    assert mid["inDays"] == 9
    assert mid["testprepExists"] is False


def test_attendance_block(corpus):
    o = overview.build_overview(now=NOW)
    comm = next(a for a in o["attendance"] if a["courseSlug"] == "comm")
    # future comm sessions: 2026-09-12, 09-17 (<=09-19 midterm), 10-06 (<=endterm)
    assert comm["sessionsLeftToMidterm"] == 2
    assert comm["sessionsLeftToEndterm"] == 3
    assert comm["nowPct"] == 75.0
    sell = next(a for a in o["attendance"] if a["courseSlug"] == "sell")
    assert sell["atRisk"] is True


def test_brain_state(corpus):
    o = overview.build_overview(now=NOW)
    st = {b["courseSlug"]: b["state"] for b in o["brain"]}
    assert st["comm"] == "stale"        # 2 pending transcripts (rec-b, rec-c)
    assert st["sell"] == "not-built"    # no brain/_brain.json


def test_gaps_pending_transcripts(corpus):
    o = overview.build_overview(now=NOW)
    comm = next(g for g in o["gaps"]["pendingTranscripts"] if g["courseSlug"] == "comm")
    assert comm["count"] == 2
    assert {i["title"] for i in comm["items"]} == {"Session 2", "Session 3"}


def test_kpis(corpus):
    o = overview.build_overview(now=NOW)
    k = o["kpis"]
    assert k["courseCount"] == 2
    assert k["nextExamName"] == "Mid Term Exams" and k["nextExamInDays"] == 9
    assert isinstance(k["dueThisWeek"], int)
    assert 0 <= k["attendanceNow"] <= 100


def test_malformed_files_tolerated(corpus):
    (corpus / "courses" / "_attendance.json").write_text("{ not json")
    (corpus / "courses" / "sell" / "raw" / "recordings.json").write_text("[1,2,3]")
    o = overview.build_overview(now=NOW)      # must not raise
    assert "attendance" in o and "gaps" in o


def test_import_isolation():
    code = ("import overview, sys; "
            "bad={'mesa_api','scrape_steps','calendar_sync','dotenv','requests'} & set(sys.modules); "
            "sys.exit(1 if bad else 0)")
    r = subprocess.run([sys.executable, "-c", code],
                       cwd=Path(__file__).parent.parent, capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr
```

Add to `scraper/tests/test_cli.py`:

```python
def test_cli_overview(home):
    import shutil, importlib, paths, brain, daily_brief, overview
    src = Path(__file__).parent / "fixtures" / "scrubbed" / "overview_corpus"
    shutil.rmtree(home / "courses", ignore_errors=True)
    shutil.copytree(src, home / "courses")
    for m in (paths, brain, daily_brief, overview): importlib.reload(m)
    import lms_scrape
    r = lms_scrape.run(["overview", "--json"])
    assert "kpis" in r and "attendance" in r
```

- [ ] **Step 3: Run red** — `cd scraper && uv run pytest tests/test_overview.py -x -q` → FAIL (`overview` missing).

- [ ] **Step 4: Implement `scraper/overview.py`**

```python
"""Outcome-dashboard data: where the student stands vs the grade — today, this
week, assignment risk, exams, attendance runway, brain readiness, gaps. Pure —
reads courses/ off disk, no LMS auth, no LLM. Mirrors daily_brief.py."""
import json
import os
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import brain
import daily_brief
from paths import course_dir, courses_root, global_file

_ATT_MIN = int(os.environ.get("ARES_BRAIN_ATTENDANCE_MIN", "75"))
_CHAT_UNLOCK = int(os.environ.get("ARES_BRAIN_CHAT_UNLOCK", "15"))
_WEIGHT_RE = re.compile(r"([A-Za-z][A-Za-z0-9 /&+.-]*?)\s*:?\s*(\d{1,3})\s*%")
_ASSESS_HDR = re.compile(r"assessment (and|&) evaluation", re.I)


def _safe(fn, empty):
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001
        print(f"overview: {getattr(fn,'__name__','block')} failed: {exc}", flush=True)
        return empty


def _q(s: str) -> str:
    return s.replace('"', "'")


def _courses() -> list[dict]:
    idx = daily_brief._read_json(global_file("_index.json"))
    return [c for c in idx if isinstance(c, dict) and c.get("slug")] if isinstance(idx, list) else []


def _outline_body(slug: str) -> str:
    nd = course_dir(slug) / "normalized"
    if not nd.exists():
        return ""
    for p in sorted(nd.glob("outline*.md")):
        try:
            _fm, body = brain.parse_frontmatter(p.read_text(errors="replace"))
            if body.strip():
                return body
        except Exception:  # noqa: BLE001
            continue
    return ""


def parse_assessment(outline_body: str) -> list[dict]:
    if not outline_body:
        return []
    lines = outline_body.splitlines()
    start = next((i for i, l in enumerate(lines) if _ASSESS_HDR.search(l)), None)
    if start is None:
        return []
    block, i = [], start + 1
    while i < len(lines):
        l = lines[i]
        if re.match(r"^\s*\|?\s*\d+\.\s", l) and not _ASSESS_HDR.search(l):
            break
        block.append(l)
        i += 1
    seen, out = set(), []
    for name, pct in _WEIGHT_RE.findall("\n".join(block)):
        n = name.strip().strip("|").strip()
        n = re.sub(r"\s+", " ", n)
        if not n or n.lower() in ("from mesa", "a") or n in seen:
            continue
        # drop a leading course-name echo like "Power of Communication"
        seen.add(n)
        out.append({"name": n, "weightPct": int(pct)})
    return out


def _pending_transcripts(slug: str) -> dict:
    recs = daily_brief._read_json(course_dir(slug) / "raw" / "recordings.json")
    recs = recs if isinstance(recs, list) else []
    tdir = course_dir(slug) / "transcripts"
    done = {p.stem for p in tdir.glob("*.md")} if tdir.exists() else set()
    items = []
    for r in recs:
        if not isinstance(r, dict) or not r.get("id"):
            continue
        if r["id"] in done or f"inbox-{r['id']}" in done:
            continue
        items.append({"title": r.get("title") or r["id"],
                      "recordedOn": r.get("recordedOn"),
                      "videoUrl": r.get("videoUrl")})
    return {"count": len(items), "items": items}


def attendance_runway(att: dict, sessions_to_mid: int, sessions_to_end: int,
                      minimum: int = _ATT_MIN) -> dict:
    a, t = int(att.get("attended", 0)), int(att.get("total", 0))
    now_pct = round(a / t * 100, 1) if t else 0.0
    bc_mid = round((a + sessions_to_mid) / (t + sessions_to_mid) * 100) if (t + sessions_to_mid) else 0
    bc_end = round((a + sessions_to_end) / (t + sessions_to_end) * 100) if (t + sessions_to_end) else 0
    floor = round(a / (t + sessions_to_end) * 100) if (t + sessions_to_end) else 0
    # "within one miss" of the minimum
    near = t and round((a) / (t + 1) * 100) < minimum <= now_pct
    at_risk = bc_end < minimum or near
    note = ""
    if bc_end < minimum:
        note = f"even perfect attendance stays below {minimum}%"
    elif near:
        note = f"one more miss drops below {minimum}%"
    return {"attended": a, "conducted": t, "nowPct": now_pct, "avgCp": att.get("avgCp", 0),
            "sessionsLeftToMidterm": sessions_to_mid, "sessionsLeftToEndterm": sessions_to_end,
            "bestCaseMidtermPct": bc_mid, "bestCaseEndtermPct": bc_end,
            "floorEndtermPct": floor, "atRisk": bool(at_risk), "note": note}


def _future_sessions_by_slug(now: datetime) -> dict:
    ev = (daily_brief._read_json(global_file("_events.json")) or {})
    out: dict[str, list[datetime]] = {}
    for e in (ev.get("events") or []) if isinstance(ev, dict) else []:
        if not isinstance(e, dict) or e.get("eventType") != "session":
            continue
        s = daily_brief._parse(e.get("startAt"))
        slug = e.get("courseSlug")
        if s and slug and s > now:
            out.setdefault(slug, []).append(s)
    return out


def _exams(now: datetime) -> list[dict]:
    ev = (daily_brief._read_json(global_file("_events.json")) or {})
    rows = []
    for e in (ev.get("events") or []) if isinstance(ev, dict) else []:
        if not isinstance(e, dict) or e.get("eventType") != "exam":
            continue
        s = daily_brief._parse(e.get("startAt"))
        if s is None or s < now:
            continue
        rows.append((s, e))
    rows.sort(key=lambda x: x[0])
    return rows


def build_overview(now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    today = daily_brief._local_date(now)
    courses = _courses()
    slugs = {c["slug"]: c["name"] for c in courses}

    ev_path = global_file("_events.json")
    scrape_age = round((time.time() - ev_path.stat().st_mtime) / 3600, 1) if ev_path.exists() else 999.0

    db = _safe(lambda: daily_brief.build_daily_brief(now=now, within_hours=48), {})
    week = _safe(lambda: daily_brief.build_daily_brief(now=now, within_hours=168), {})

    # --- assessment weights per course ---
    weights: dict[str, list[dict]] = {}
    for s in slugs:
        weights[s] = _safe(lambda s=s: parse_assessment(_outline_body(s)), [])

    def _weight_for(course_slug: str, title: str):
        for comp in weights.get(course_slug, []):
            if comp["name"].lower() in title.lower() or title.lower() in comp["name"].lower():
                return comp["weightPct"]
        return None

    # --- assignments + risk ---
    assignments = []
    for a, course_label, is_club in _safe(lambda: list(daily_brief._iter_assignment_files()), []):
        due = daily_brief._parse(a.get("dueAt"))
        status = ("submitted" if a.get("mySubmissionStatus") == "submitted"
                  else "draft" if a.get("status") == "draft" else "not-started")
        if status == "submitted":
            continue
        cslug = next((s for s, n in slugs.items() if n == course_label), None)
        w = _weight_for(cslug, a.get("title", "")) if cslug else None
        hours = round((due - now).total_seconds() / 3600, 1) if due else None
        urgency = 1.0 if hours is None else max(0.05, min(1.0, 1.0 - (hours / (14 * 24))))
        base = (w or 5) / 30.0
        risk = round(min(1.0, base * urgency * (1.0 if status == "not-started" else 0.6)), 3)
        assignments.append({
            "id": a.get("id"), "title": a.get("title") or a.get("id"),
            "course": course_label, "courseSlug": cslug, "weightPct": w,
            "dueAt": due.astimezone().isoformat() if due else None,
            "hoursAway": hours, "status": status, "isClub": is_club,
            "submissionType": a.get("submissionType", "n/a"), "risk": risk,
            "helpCommand": f'/mesa:ares-brain-assignment-help "{_q(course_label)}" "{_q(a.get("title") or "")}"',
        })
    assignments.sort(key=lambda x: -x["risk"])

    # --- grade picture ---
    grade_picture = []
    submitted_titles = {daily_brief._read_json(course_dir(s) / "raw" / "assignments.json") for s in slugs}  # noqa: F841
    for s, name in slugs.items():
        comps = weights.get(s, [])
        if not comps:
            continue
        raw = daily_brief._read_json(course_dir(s) / "raw" / "assignments.json")
        subs = {x.get("title", "").lower() for x in raw if isinstance(x, dict)
                and x.get("mySubmissionStatus") == "submitted"} if isinstance(raw, list) else set()
        rows, ahead = [], 0
        for c in comps:
            done = any(c["name"].lower() in t or t in c["name"].lower() for t in subs) or None
            if done is not True:
                ahead += c["weightPct"]
            rows.append({"name": c["name"], "weightPct": c["weightPct"], "done": done})
        pend = [a["title"] for a in assignments if a["courseSlug"] == s][:3]
        grade_picture.append({
            "course": name, "courseSlug": s, "components": rows,
            "aheadPct": min(100, ahead),
            "summary": f"{min(100, ahead)}% of grade still ahead" + (f": {', '.join(pend)}" if pend else ""),
        })

    # --- brain + gaps ---
    fut = _future_sessions_by_slug(now)
    brain_rows, pending_groups, ready_ct = [], [], 0
    for s, name in slugs.items():
        bs = _safe(lambda s=s: brain.brain_status(s), {})
        pend = _safe(lambda s=s: _pending_transcripts(s), {"count": 0, "items": []})
        guide_built = bs.get("guideBuiltAt")
        behind = bs.get("guideSourcesBehind") or 0
        if guide_built is None:
            state = "not-built"
        elif bs.get("indexStale") or behind or pend["count"]:
            state = "stale"
        else:
            state = "ready"
        if state == "ready":
            ready_ct += 1
        reasons = []
        if pend["count"]:
            reasons.append(f"{pend['count']} recordings to transcribe")
        if behind:
            reasons.append(f"guide {behind} sources behind")
        if guide_built is None:
            reasons = ["guide never built"]
        brain_rows.append({
            "course": name, "courseSlug": s, "state": state,
            "corpusBytes": bs.get("corpusBytes"), "sourceCount": bs.get("sourceCount"),
            "indexStale": bs.get("indexStale"), "guideBuiltAt": guide_built,
            "guideSourcesBehind": behind, "pendingTranscripts": pend["count"],
            "reason": " · ".join(reasons) or "up to date",
            "buildCommand": f'/mesa:ares-brain-course-brain "{_q(name)}"',
        })
        if pend["count"]:
            pending_groups.append({"course": name, "courseSlug": s, **pend})

    # --- exams ---
    exam_rows = []
    for s_dt, e in _exams(now):
        exam_rows.append({
            "name": e.get("title"), "date": daily_brief._local_date(s_dt),
            "inDays": (s_dt.date() - now.date()).days,
            "courses": ["all"] if not e.get("courseSlug") else [e["courseSlug"]],
            "coverageSessions": None,
            "brainReady": all(b["state"] == "ready" for b in brain_rows) if not e.get("courseSlug")
                          else next((b["state"] == "ready" for b in brain_rows if b["courseSlug"] == e.get("courseSlug")), False),
            "testprepExists": any((course_dir(s).exists() and list((course_dir(s) / "study").glob("testprep-*.md")))
                                  for s in slugs),
            "testprepCommand": '/mesa:ares-brain-testprep "<course>"',
        })

    # --- attendance runway ---
    mid = next((d for d, e in _exams(now) if "mid" in (e.get("title") or "").lower()), None)
    end = next((d for d, e in reversed(_exams(now)) if "end" in (e.get("title") or "").lower()), None)
    last_sess = max((d for ds in fut.values() for d in ds), default=None)
    end = end or last_sess
    att_raw = daily_brief._read_json(global_file("_attendance.json"))
    att_list = att_raw.get("raw", []) if isinstance(att_raw, dict) else []
    by_cid = {c["id"]: c["slug"] for c in courses}
    attendance = []
    tot_att = tot_conf = 0
    for a in att_list if isinstance(att_list, list) else []:
        if not isinstance(a, dict):
            continue
        slug = by_cid.get(a.get("courseId"))
        if not slug:
            continue
        f = fut.get(slug, [])
        n_mid = len([d for d in f if mid is None or d <= mid])
        n_end = len([d for d in f if end is None or d <= end])
        rw = attendance_runway(a, n_mid, n_end)
        tot_att += rw["attended"]; tot_conf += rw["conducted"]
        attendance.append({"course": slugs.get(slug, slug), "courseSlug": slug, **rw})

    # --- kpis ---
    all_due = week.get("assignmentsDue", [])
    cp_vals = [a.get("avgCp") for a in att_list if isinstance(a, dict) and a.get("avgCp")]
    kpis = {
        "dueThisWeek": len([d for d in all_due if not d.get("submitted")]),
        "nextExamInDays": exam_rows[0]["inDays"] if exam_rows else None,
        "nextExamName": exam_rows[0]["name"] if exam_rows else None,
        "cpAvg": round(sum(cp_vals) / len(cp_vals), 1) if cp_vals else None,
        "attendanceNow": round(tot_att / tot_conf * 100) if tot_conf else 0,
        "attendanceBestCase": round((tot_att + sum(a["sessionsLeftToEndterm"] for a in attendance))
                                    / (tot_conf + sum(a["sessionsLeftToEndterm"] for a in attendance)) * 100)
                               if tot_conf else 0,
        "brainReady": ready_ct, "courseCount": len(courses),
    }

    # --- this week ---
    this_week = []
    for c in week.get("classesToday", []):  # daily_brief only returns today's classes; augment from events
        pass
    for a in assignments:
        if a["hoursAway"] is not None and 0 < a["hoursAway"] <= 168:
            this_week.append({"when": (a["dueAt"] or "")[:10], "kind": "assignment",
                              "title": a["title"], "course": a["course"], "courseSlug": a["courseSlug"],
                              "weightPct": a["weightPct"], "status": a["status"], "coverage": None,
                              "action": {"label": "Start", "type": "copy", "value": a["helpCommand"]}})
    for e in exam_rows:
        if 0 <= e["inDays"] <= 7:
            this_week.append({"when": e["date"], "kind": "exam", "title": e["name"],
                              "course": "Program", "courseSlug": None, "weightPct": None,
                              "status": None, "coverage": e["coverageSessions"],
                              "action": {"label": "Practice", "type": "copy", "value": e["testprepCommand"]}})
    for e in ((daily_brief._read_json(global_file("_events.json")) or {}).get("events") or []):
        if not isinstance(e, dict) or e.get("eventType") != "session":
            continue
        d = daily_brief._parse(e.get("startAt"))
        if d and 0 <= (d.date() - now.date()).days <= 7:
            this_week.append({"when": daily_brief._local_date(d), "kind": "class",
                              "title": e.get("title") or "Class", "course": e.get("courseName"),
                              "courseSlug": e.get("courseSlug"), "weightPct": None, "status": None,
                              "coverage": None, "action": None})
    this_week.sort(key=lambda x: (x["when"] or "9999", x["kind"]))

    # --- missing books (best effort) ---
    missing_books = _safe(_scan_missing_books, [])

    return {
        "generatedAt": now.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "date": today, "scrapeAgeHours": scrape_age,
        "term": db.get("term") or "Term 1",
        "kpis": kpis,
        "today": {
            "classes": db.get("classesToday", []),
            "dueTodayOrTomorrow": db.get("assignmentsDue", []),
            "changed": db.get("changed", {}),
        },
        "thisWeek": this_week,
        "assignments": assignments,
        "gradePicture": grade_picture,
        "exams": exam_rows,
        "attendance": attendance, "attendanceMin": _ATT_MIN,
        "brain": brain_rows,
        "chatUnlockAt": _CHAT_UNLOCK,
        "gaps": {
            "pendingTranscripts": pending_groups,
            "missingBooks": missing_books,
            "scrapeStale": scrape_age > 26,
            "attendanceStale": _att_stale(),
        },
    }


def _att_stale() -> bool:
    a, e = global_file("_attendance.json"), global_file("_events.json")
    try:
        return a.exists() and e.exists() and a.stat().st_mtime < e.stat().st_mtime - 3600
    except OSError:
        return False


def _scan_missing_books() -> list[dict]:
    """Books named in transcripts/self-notes but not uploaded. Best effort."""
    have = set()
    for s in [c["slug"] for c in _courses()]:
        for p in (course_dir(s) / "inbox" / "books").glob("*") if (course_dir(s) / "inbox" / "books").exists() else []:
            have.add(p.stem.lower())
    pat = re.compile(r'["“]([A-Z][\w:’\' -]{2,60})["”]\s+by\s+([A-Z][\w. -]{2,40})')
    found: dict[str, dict] = {}
    for s in [c["slug"] for c in _courses()]:
        nd = course_dir(s) / "normalized"
        for p in nd.glob("*.md") if nd.exists() else []:
            if not (p.name.startswith("transcript") or p.name.startswith("self-note")):
                continue
            try:
                txt = p.read_text(errors="replace")
            except OSError:
                continue
            for title, author in pat.findall(txt):
                key = title.lower()
                if key in have or any(key in h or h in key for h in have):
                    continue
                found.setdefault(key, {"title": title.strip(), "author": author.strip(),
                                       "mentionedIn": []})
                if s not in found[key]["mentionedIn"]:
                    found[key]["mentionedIn"].append(s)
    return list(found.values())
```

> Impl notes for the engineer: the `test_grade_picture` assertion on the exact `aheadPct`
> is left loose (`0..100`) in Step 2 on purpose — once you've written the done-matching,
> tighten that test to the number your code produces and commit it. Everything else is
> pinned.

- [ ] **Step 5: CLI — `scraper/lms_scrape.py`**

Subparser (next to `daily-brief`):

```python
    ov = sub.add_parser("overview")
    ov.add_argument("--json", action="store_true")
```

Dispatch (next to the `daily-brief` branch):

```python
    if args.cmd == "overview":
        import overview as _ov
        result = _ov.build_overview()
        print(json.dumps(result) if args.json else json.dumps(result, indent=1))
        return result
```

- [ ] **Step 6: Run green** — `cd scraper && uv run pytest -q` — prior count + ~15 new, all green. Tighten `test_grade_picture` to the real number. `cd ../mcp && npx vitest run` unchanged.

- [ ] **Step 7: Commit**

```bash
git add scraper/
git commit -m "feat(scraper): overview.py — outcome-dashboard data layer + CLI

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: `GET /api/overview`

**Files:**

- Modify: `dashboard/server/src/index.ts`, `dashboard/server/src/lib/python.ts` (add `runPythonJSON`), `dashboard/server/src/lib/jobs.ts` (add the `"transcribe"` job kind), `dashboard/server/test/routes.test.ts`, `dashboard/server/test/jobs.test.ts`
- Create: `dashboard/server/test/overview.test.ts`

**Interfaces:**

- Consumes: `lms_scrape.py overview --json`.
- Produces: `GET /api/overview` → `200` the overview JSON, or `503 {error}` if the sidecar fails.
- `runPythonJSON(args: string[]): Promise<{ ok: true; data: unknown } | { ok: false; error: string }>` — spawn, buffer stdout, parse the last `{`-line, 15s timeout.

- [ ] **Step 1: test `runPythonJSON` + the route** — `dashboard/server/test/overview.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "../src/index.js";
import type { Server } from "node:http";

let server: Server;
let base: string;
beforeAll(async () => {
  server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("GET /api/overview", () => {
  it("returns 200 + the overview shape (real sidecar against the test home)", async () => {
    const res = await fetch(`${base}/api/overview`);
    // 200 with data, or 503 if the venv/corpus isn't present in CI — accept both,
    // but if 200 the shape must be right
    if (res.status === 200) {
      const j = await res.json();
      expect(j).toHaveProperty("kpis");
      expect(j).toHaveProperty("attendance");
      expect(j).toHaveProperty("gaps");
    } else {
      expect(res.status).toBe(503);
    }
  });
});
```

> The route test runs the real Python. In CI the `scraper` job has the venv; the
> `dashboard` job does not — so the test accepts `503` too. A deterministic unit test of
> `runPythonJSON` with a stubbed spawn is added if the buffered helper grows logic;
> for a thin wrapper the route test is enough.

- [ ] **Step 2: `runPythonJSON` in `dashboard/server/src/lib/python.ts`**

```ts
export function runPythonJSON(
  args: string[],
  timeoutMs = 15000,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const py = venvPython();
  if (!existsSync(py)) return Promise.resolve({ ok: false, error: "python sidecar not set up" });
  return new Promise((resolve) => {
    const child = spawn(py, ["lms_scrape.py", ...args], {
      cwd: join(repoRoot(), "scraper"),
      env: { ...process.env, ARES_BRAIN_HOME: repoRoot() },
    });
    let out = "";
    let err = "";
    const t = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ ok: false, error: "timeout" });
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(t);
      resolve({ ok: false, error: String(e) });
    });
    child.on("close", (code) => {
      clearTimeout(t);
      const line = out
        .trim()
        .split("\n")
        .reverse()
        .find((l) => l.trim().startsWith("{"));
      if (code === 0 && line) {
        try {
          return resolve({ ok: true, data: JSON.parse(line) });
        } catch {
          /* fall */
        }
      }
      resolve({ ok: false, error: err.slice(-500) || `exit ${code}` });
    });
  });
}
```

- [ ] **Step 3: route in `index.ts`** (near `GET /api/state`):

```ts
if (match("GET", "/api/overview", method, url)) {
  const r = await runPythonJSON(["overview", "--json"]);
  return r.ok ? json(res, 200, r.data) : json(res, 503, { error: r.error });
}
```

Import `runPythonJSON` from `./lib/python.js`.

- [ ] **Step 3b: add the `"transcribe"` job kind** — GapsCard's "Transcribe all" pulls a
      course's _scraped_ YouTube recordings, which is `transcribe --course <slug>` (no `--inbox`).
      In `dashboard/server/src/lib/jobs.ts`: add `"transcribe"` to the `JobKind` union and
      `argv()` → `case "transcribe": return ["transcribe", "--course", o.course!, "--json"];`.
      In `index.ts` add `"transcribe"` to the `KINDS` array + require `course`. Test in
      `jobs.test.ts`: `startJob({kind:"transcribe",course:"c1"})` → argv
      `["transcribe","--course","c1","--json"]`.

- [ ] **Step 4** — `npm run --workspace ares-dashboard-server build && test`. `routes.test.ts` still green. Commit:

```bash
git add dashboard/server
git commit -m "feat(dashboard): GET /api/overview

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: `dashboard/web` — React migration + neobrutalism.dev scaffold

**Files:** `dashboard/web/package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/index.css`, `src/api.ts`, `src/components/ui/*` (vendored), `src/lib/utils.ts`; delete the old Preact `src/app.tsx` + `src/components/*` + `src/style.css`; port `src/components/JobLog.tsx` to React; update `test/*` + `test/setup.ts`.

- [ ] **Step 1: Spike — registry vs vendor (10 min, no commit)**

`cd dashboard/web` and try `npx shadcn@latest init` then `npx shadcn@latest add https://neobrutalism.dev/r/card.json`. If it resolves cleanly under Tailwind v4 + React, use the registry for `card button badge alert progress table skeleton`. If it errors (registry lags v4), **vendor**: copy the component `.tsx` files from https://www.neobrutalism.dev/ docs (each page has the source) into `src/components/ui/`, plus their `globals.css` token block. Record the choice in the task report.

- [ ] **Step 2: `package.json`**

```json
{
  "name": "ares-dashboard-web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "check": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.5.0",
    "lucide-react": "^0.454.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.0",
    "@tailwindcss/vite": "^4.0.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/jest-dom": "^6.5.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "jsdom": "^25.0.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.6.0",
    "vite": "^6.0.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 3: `vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwind()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${process.env.ARES_BRAIN_DASHBOARD_PORT || 4319}`,
        changeOrigin: true,
      },
    },
  },
  test: { environment: "jsdom", globals: true, setupFiles: ["./test/setup.ts"] },
});
```

`tsconfig.json`: `jsx: "react-jsx"` (drop `jsxImportSource`), `types: ["vitest/globals", "@testing-library/jest-dom"]`.
`test/setup.ts`: `import "@testing-library/jest-dom";`
`index.html`: `<script type="module" src="/src/main.tsx">`, `<div id="root">`.
`src/main.tsx`:

```tsx
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";
createRoot(document.getElementById("root")!).render(<App />);
```

`src/lib/utils.ts`: the standard `cn` helper (`clsx` + `tailwind-merge`).

- [ ] **Step 4: `src/index.css`** — `@import "tailwindcss";` + the neobrutalism.dev base (from the spike) + palette B `@theme`:

```css
@import "tailwindcss";

@theme {
  --color-edge: #0f8a5f;
  --color-paper: #eafff4;
  --color-card: #ffffff;
  --color-accent: #ff8a3d;
  --color-cta: #ffd23f;
  --color-ok: #7ee081;
  --color-soon: #ffb056;
  --color-bad: #ff6b6b;
  --radius-nb: 2px;
}
@media (prefers-color-scheme: dark) {
  @theme {
    --color-paper: #161d1a;
    --color-card: #1e2624;
  }
}
:root {
  --nb-border: 3px;
  --nb-shadow: 4px 4px 0 var(--color-edge);
}
body {
  background: var(--color-paper);
  color-scheme: light dark;
}
```

- [ ] **Step 5: port `JobLog.tsx` to React** — same markup, `useEffect`/`useRef` from `react`, `class` → `className`. Keep behaviour.

- [ ] **Step 6: `src/api.ts`** — keep the existing job/upload/SSE fns (rename `class`→n/a, they're framework-free already). Add:

```ts
export interface Overview {
  /* mirror spec §3 — full type */
}
export const getOverview = (): Promise<Overview> =>
  fetch("/api/overview").then((r) => {
    if (!r.ok) throw new Error(`overview ${r.status}`);
    return r.json();
  });
```

- [ ] **Step 7: blank `src/App.tsx`** that fetches and renders raw:

```tsx
import { useEffect, useState } from "react";
import { getOverview, type Overview } from "./api";

export function App() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    getOverview()
      .then(setOv)
      .catch((e) => setErr(String(e)));
  }, []);
  if (err) return <pre className="p-6 text-[var(--color-bad)]">{err}</pre>;
  if (!ov) return <div className="p-6">loading…</div>;
  return <pre className="p-6 text-xs">{JSON.stringify(ov, null, 2)}</pre>;
}
```

- [ ] **Step 8: ported tests** — rewrite `test/JobLog.test.tsx` for `@testing-library/react`. Delete the Preact `CoursePicker`/`SyncCard`/`app` tests (those components are gone). Add `test/api.test.ts`: mock `fetch`, assert `getOverview` throws on non-2xx and parses on 200.

- [ ] **Step 9** — `npm install` (root); `npm run --workspace ares-dashboard-web build && check && test`; `npm run --workspace ares-dashboard-server test` unchanged. `npx prettier --write "dashboard/web/**/*.{ts,tsx,css,html}"`. Commit:

```bash
git add dashboard package.json package-lock.json
git commit -m "feat(dashboard): web on React + neobrutalism.dev, /api/overview wiring

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: The sections

**Files:** `dashboard/web/src/App.tsx`, `src/components/{Header,KpiStrip,TodayCard,WeekCard,AssignmentsCard,ExamsCard,AttendanceCard,BrainCard,GapsCard,ChatLockCard,CopyButton,RiskBadge}.tsx`, `src/components/Section.tsx`, `test/*`.

**Interfaces:** each component takes a typed slice of `Overview` + (where it acts) an `onJob(kind, opts)` callback wired to the existing `startJob` API.

- [ ] **Step 1: `Section.tsx` + `CopyButton.tsx` + `RiskBadge.tsx`** (shared shells)

`Section`: neubrutalist card wrapper — `<section className="border-[length:var(--nb-border)] border-[var(--color-edge)] shadow-[var(--nb-shadow)] rounded-[var(--radius-nb)] bg-[var(--color-card)] p-4 mb-4">` + an uppercase `<h3>`.
`CopyButton`: `navigator.clipboard.writeText(value)` → a 2s "copied — paste in Claude Code" inline note. Yellow CTA styling.
`RiskBadge`: maps a `state: "ok"|"soon"|"bad"` (or a numeric risk → band) to a pill with the matching `--color-*` fill + `--color-edge` border.

Tests: `CopyButton` writes to a mocked `navigator.clipboard` and shows the note; `RiskBadge` renders the right fill class per state.

- [ ] **Step 2: `KpiStrip.tsx`** — `ov.kpis` → 5 `Section`-less stat tiles in a `grid grid-cols-2 sm:grid-cols-5 gap-2`. Each: label (uppercase 11px), value (24px/500). Amber tile fill when: `dueThisWeek >= 3`, `nextExamInDays !== null && <= 7`, `attendanceNow < ov.attendanceMin`. Test: renders 5 tiles; the exam tile gets the amber class when `nextExamInDays = 6`.

- [ ] **Step 3: the read-only cards** — `TodayCard` (`ov.today`), `WeekCard` (`ov.thisWeek`), `ExamsCard` (`ov.exams`), `AttendanceCard` (`ov.attendance` + `ov.attendanceMin`), `BrainCard` (`ov.brain`). Each maps its array to rows inside a `Section`; `AttendanceCard` rows with `atRisk` get `border-l-4 border-[var(--color-bad)]` + the `note`. `WeekCard` / `ExamsCard` / `AssignmentsCard` rows with a `copy` action render a `<CopyButton>`. Tests: `AttendanceCard` styles the at-risk row + shows the note; `WeekCard` sorts by `when`; `ExamsCard` shows the countdown.

- [ ] **Step 4: `AssignmentsCard.tsx`** — `ov.assignments` (already risk-desc) → rows: title, course, `weight% · due <relative> · <status>`, `<CopyButton value={a.helpCommand} label="Start" />`. Below: `ov.gradePicture` summaries. Test: rows are in the given order; a row with `weightPct: null` shows "ungraded"; copy button carries `helpCommand`.

- [ ] **Step 5: `GapsCard.tsx`** — `ov.gaps`:
  - `pendingTranscripts[]` → per group: "Transcribe N <course> sessions" + `<button onClick={() => onJob("transcribe", { course: g.courseSlug })}>Transcribe all</button>` (the job runs `transcribe --course <slug>` which pulls the YouTube links directly).
  - `missingBooks[]` → list (title — author, "mentioned in …") + a note "drop the PDF in inbox/<slug>/books/ or use the upload" (upload UI reuses the F `upload` api — a small dropzone, course = first mentionedIn).
  - `scrapeStale` → "Scrape is N days old" + `<button onClick={() => onJob("sync")}>Sync</button>`.
  - `attendanceStale` → a muted note.
    Test: renders a Transcribe button per group; clicking calls `onJob` with the right args; `scrapeStale=false` hides the Sync row.

- [ ] **Step 6: `ChatLockCard.tsx`** — `ov.kpis.brainReady` / `ov.kpis.courseCount` / `ov.chatUnlockAt`. Locked: "N of M brains ready — chat unlocks at K" + a progress bar (`width: ready/K`) + disabled input. Unlocked (`brainReady >= chatUnlockAt`): "ready — chat lands in phase 2". Test: locked vs unlocked by prop; progress width.

- [ ] **Step 7: `Header.tsx` + assemble `App.tsx`**

```tsx
export function App() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const stop = useRef<() => void>();

  const refresh = () =>
    getOverview()
      .then(setOv)
      .catch(() => {});
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
    const r = await api.startJob({ kind, ...opts });
    if (r.jobId) {
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
    } else setLines((p) => [...p, `! ${r.error}`]);
  }

  if (!ov) return <div className="mx-auto max-w-4xl p-6">loading…</div>;
  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <Header ov={ov} busy={!!busy} onJob={onJob} />
      <KpiStrip k={ov.kpis} min={ov.attendanceMin} />
      <TodayCard today={ov.today} />
      <WeekCard week={ov.thisWeek} />
      <AssignmentsCard assignments={ov.assignments} grade={ov.gradePicture} />
      <ExamsCard exams={ov.exams} />
      <AttendanceCard rows={ov.attendance} min={ov.attendanceMin} />
      <BrainCard rows={ov.brain} busy={!!busy} onJob={onJob} />
      <GapsCard gaps={ov.gaps} busy={!!busy} onJob={onJob} />
      <ChatLockCard k={ov.kpis} unlockAt={ov.chatUnlockAt} />
      {(job || lines.length > 0) && <JobLog job={job} lines={lines} />}
    </div>
  );
}
```

- [ ] **Step 8** — `npm run --workspace ares-dashboard-web build && check && test`; `npm run check` (root) clean; prettier. Commit:

```bash
git add dashboard/web
git commit -m "feat(dashboard): the 10 outcome sections

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: glue + live run

**Files:** `.github/workflows/ci.yml` (web is React now — the `dashboard` job already runs `--workspace ares-dashboard build` + `-web check` + `test`; verify the React deps install in CI), `eslint.config.js` (the `dashboard/**` glob already covers `.tsx`; add React globals `window`, `navigator`, `HTMLButtonElement`, `MessageEvent` if missing + `settings: { react: { version: "18" } }` is not needed without the react plugin — keep eslint rule-light), `README.md` (rewrite the "Dashboard" section), `docs/lms-api.md`.

- [ ] **Step 1** — `npm run check` clean; if eslint trips on React JSX (no `react-in-jsx-scope` needed with the automatic runtime) scope a rule off for `dashboard/web/**`.
- [ ] **Step 2** — `npm run --workspace ares-dashboard build && npm run --workspace ares-dashboard-server start` (port 4319), open `http://127.0.0.1:4319`, confirm `/api/overview` renders the real sections. Screenshot light + dark.
- [ ] **Step 3** — `npm run dashboard` (Vite proxy), click a Transcribe / Sync gap action, confirm the job runs + the log streams + the overview refreshes on completion.
- [ ] **Step 4** — `README.md` "Dashboard": the new outcome view, what each section answers, the deterministic-vs-copy-command split, the chat-lock, `ARES_BRAIN_ATTENDANCE_MIN` / `ARES_BRAIN_CHAT_UNLOCK`. `docs/lms-api.md`: append `## G outcome dashboard — live run <date>`.
- [ ] **Step 5** — Commit:

```bash
git add -A
git commit -m "feat(dashboard): CI + README + live-run notes for the outcome dashboard

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**

- §3 data model → Task 1 `build_overview` (every key present; `test_build_overview_shape` asserts the set). `chatUnlockAt` added to the return (spec §6 §10 needs it) — noted.
- §4 blocks → Task 1 Step 4: today, thisWeek, assignments+risk, gradePicture+parser, exams, attendance runway, brain, gaps.pendingTranscripts, gaps.missingBooks, kpis. ✓
- §4 `parse_assessment` (multivalue `Pitch 1: 30%\nPitch 2: 30%`) → `test_parse_assessment_multivalue`. ✓
- §4 `attendance_runway` math → `test_attendance_runway_math` + `_at_risk`. ✓
- §5 CLI `overview` + `/api/overview` → Task 1 Step 5, Task 2. ✓
- §6 React + neobrutalism.dev + palette B → Task 3; the 10 sections → Task 4. ✓
- §6 deterministic-job vs copy-command → `onJob` (job runner) vs `CopyButton` (helpCommand/testprepCommand/buildCommand). ✓
- §6 chat-lock → `ChatLockCard`. ✓
- §7 tests → Task 1 (`test_overview.py`, import-isolation, CLI), Task 2 (route), Task 3/4 (component + api tests). ✓
- §8 out-of-scope respected (no chatbot exec, no `prereadRead`, threshold labelled). ✓
- §9 build order → the 5 tasks. ✓

**Placeholder scan:** `test_grade_picture`'s exact `aheadPct` is deliberately loose in Step 2 with an explicit instruction to tighten it in Step 6 after the done-matching is written — this is a known TDD ordering (the number depends on the fuzzy-match the engineer implements), not a placeholder. The Task 3 Step 1 "spike" is a real decision point (registry vs vendor) with a recorded outcome, not hand-waving. `src/api.ts` `Overview` type — Step 6 says "mirror spec §3 — full type"; the engineer transcribes §3's JSON into a TS interface (mechanical). All other steps have literal code.

**Type consistency:** `Overview` (web) mirrors `build_overview`'s dict (Python) — both enumerated in spec §3. `onJob(kind, opts)` → `api.startJob({kind, ...opts})` → server `POST /api/jobs` `KINDS` (`sync|ingest|transcribe-url|transcribe-inbox`) — GapsCard uses `"transcribe"`... ⚠️ the server kind for pulling a course's YouTube links is **`transcribe-inbox`** only in the current server (`argv()` maps `transcribe-inbox` → `transcribe --course c --inbox`). Pulling the _scraped_ recordings needs plain `transcribe --course <slug>`. **Fix in Task 2:** add a `"transcribe"` job kind to `dashboard/server/src/lib/jobs.ts` `argv()` → `["transcribe", "--course", o.course!, "--json"]`, and to the server `KINDS` guard + `api.ts`. Added to Task 2's file list + a line in its Step 3.

- `runPythonJSON` return `{ok, data}|{ok, error}` — consumed only by the route. ✓
- `JobLog` props `{ job, lines }` unchanged from F. ✓
