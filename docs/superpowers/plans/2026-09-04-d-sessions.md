# D-sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** `build_desired_events` also emits future `session` + `event` entries from `courses/_events.json`, with room as location and a 24h/2h reminder set (env-tunable).

**Architecture:** One new loop in `build_desired_events` after the exam loop; `_event_body` gains an optional `location`; `canonical` includes it; new `_session_reminders()` env helper. Nothing else in `calendar_sync.py` moves.

**Tech Stack:** Python 3.12 (`uv` venv). No new deps.

## Global Constraints

- `scraper/calendar_sync.py` module-top imports: stdlib + `from paths import ...` ONLY. `google.*` lazy inside functions. NO `scrape_steps`. `test_calendar_sync_import_isolation` must stay green.
- `.env` never read/printed.
- `run()` / `reconcile` / `ensure_calendar` / `_service` / `do_auth` / MCP tool / `/mesa:ares-brain-calendar-sync` command / `courses/_calendar.json` state shape — UNCHANGED.
- Reconcile stays per-item try/except.
- Branch `d-sessions` off `main` (already created). TDD. One task.

---

## Task 1: sessions + program events in `build_desired_events`

**Files:**

- Modify: `scraper/calendar_sync.py`
- Modify: `scraper/tests/test_calendar_sync.py`
- Modify: `scraper/tests/fixtures/scrubbed/calendar_corpus/_events.json`
- Modify: `docs/lms-api.md` (live-run record, Step 8)

**Interfaces:**

- Consumes: `_parse`, `_reminders`, `_hash`, `_read_or_none`, `global_file`, `_event_body` (all existing in `calendar_sync.py`).
- Produces: `calendar_sync._session_reminders() -> list[int]`; `_event_body` gains `location: str | None = None` kwarg; `build_desired_events` output gains `session:<id>` / `event:<id>` keys.

- [ ] **Step 1: Enrich the test fixture**

Replace `scraper/tests/fixtures/scrubbed/calendar_corpus/_events.json` with:

```json
{
  "window": { "from": "x", "to": "y" },
  "events": [
    {
      "id": "ex-fut",
      "eventType": "exam",
      "title": "Mid Term Exam",
      "startAt": "2026-09-19T08:30:00.000Z",
      "endAt": "2026-09-19T11:30:00.000Z",
      "courseName": "Program"
    },
    {
      "id": "ex-past",
      "eventType": "exam",
      "title": "Baseline Assessment",
      "startAt": "2026-08-22T08:30:00.000Z",
      "endAt": "2026-08-22T10:00:00.000Z"
    },
    {
      "id": "sess-1",
      "eventType": "session",
      "title": "Marketing Strategy with Prof. Menon",
      "startAt": "2026-09-20T04:00:00.000Z",
      "endAt": "2026-09-20T05:30:00.000Z",
      "courseName": "Crafting Marketing Strategies",
      "room": "Delta Classroom",
      "instructorName": "Siddarth Menon",
      "meetingLink": "https://youtu.be/live-abc"
    },
    {
      "id": "sess-past",
      "eventType": "session",
      "title": "Old class",
      "startAt": "2026-08-15T04:00:00.000Z",
      "endAt": "2026-08-15T05:30:00.000Z"
    },
    {
      "id": "sess-baddate",
      "eventType": "session",
      "title": "Broken class",
      "startAt": "not-a-date"
    },
    {
      "id": "evt-1",
      "eventType": "event",
      "title": "Guest Lecture: Founder Stories",
      "startAt": "2026-09-21T09:00:00.000Z",
      "endAt": "2026-09-21T10:00:00.000Z",
      "courseName": "Program",
      "room": "Auditorium"
    }
  ]
}
```

- [ ] **Step 2: Write the failing tests**

In `scraper/tests/test_calendar_sync.py`, UPDATE `test_build_desired_event_keys` — the key set now includes the two future non-exam events:

```python
def test_build_desired_event_keys(corpus):
    d = calendar_sync.build_desired_events(now=NOW)
    assert set(d) == {"asg:a-fut:due", "asg:a-cut:due", "asg:a-cut:cutoff",
                      "asg:club-1:due", "exam:ex-fut",
                      "session:sess-1", "event:evt-1"}
    # excluded: submitted / past / draft assignments, ex-past, sess-past (past),
    #           sess-baddate (unparseable startAt)
```

ADD these tests:

```python
def test_session_event_body(corpus):
    b = calendar_sync.build_desired_events(now=NOW)["session:sess-1"]["body"]
    assert b["summary"] == "Marketing Strategy with Prof. Menon"
    assert b["start"]["dateTime"] == "2026-09-20T04:00:00+00:00"
    assert b["end"]["dateTime"] == "2026-09-20T05:30:00+00:00"
    assert b["location"] == "Delta Classroom"
    assert "Course: Crafting Marketing Strategies" in b["description"]
    assert "Instructor: Siddarth Menon" in b["description"]
    assert "Link: https://youtu.be/live-abc" in b["description"]
    assert "Type: session" in b["description"]
    assert {o["minutes"] for o in b["reminders"]["overrides"]} == {1440, 120}


def test_generic_event_body(corpus):
    b = calendar_sync.build_desired_events(now=NOW)["event:evt-1"]["body"]
    assert b["summary"] == "Guest Lecture: Founder Stories"
    assert b["location"] == "Auditorium"
    assert "Type: event" in b["description"]


def test_event_body_location_kwarg():
    from datetime import datetime, timezone
    dt = datetime(2026, 9, 20, 4, 0, tzinfo=timezone.utc)
    with_loc = calendar_sync._event_body("S", dt, "d", [120], end=dt, location="Room 5")
    assert with_loc["location"] == "Room 5"
    assert '"location": "Room 5"' in calendar_sync.canonical(with_loc)
    no_loc = calendar_sync._event_body("S", dt, "d", [120], end=dt)
    assert "location" not in no_loc


def test_session_reminders_env(monkeypatch):
    monkeypatch.delenv("CALENDAR_SESSION_REMINDERS", raising=False)
    assert calendar_sync._session_reminders() == calendar_sync._reminders()
    monkeypatch.setenv("CALENDAR_SESSION_REMINDERS", "15")
    assert calendar_sync._session_reminders() == [15]
    monkeypatch.setenv("CALENDAR_SESSION_REMINDERS", "")
    assert calendar_sync._session_reminders() == []
    monkeypatch.setenv("CALENDAR_SESSION_REMINDERS", "junk")
    assert calendar_sync._session_reminders() == calendar_sync._reminders()
```

- [ ] **Step 3: Run, verify failure**

Run: `cd scraper && uv run pytest tests/test_calendar_sync.py -k "desired_event_keys or session or generic_event or event_body_location" -v`
Expected: FAIL — `_session_reminders` undefined, `location` kwarg rejected, keys missing.

- [ ] **Step 4: Implement in `scraper/calendar_sync.py`**

**4a.** Module docstring line 1: change `assignment/exam deadlines` → `assignment / exam / class schedule`.

**4b.** After `_reminders()` (around line 34) add:

```python
def _session_reminders() -> list[int]:
    raw = os.environ.get("CALENDAR_SESSION_REMINDERS")
    if raw is None:
        return _reminders()
    if not raw.strip():
        return []
    try:
        return [int(x) for x in raw.split(",") if x.strip()]
    except ValueError:
        return _reminders()
```

**4c.** `_event_body` — add the kwarg and the conditional key:

```python
def _event_body(summary: str, deadline: datetime, description: str,
                reminders: list[int], *, end: datetime | None = None,
                location: str | None = None) -> dict:
    end = end or deadline
    start = deadline - timedelta(minutes=30) if end == deadline else deadline
    body = {
        "summary": summary,
        "start": {"dateTime": start.isoformat(), "timeZone": _TZ},
        "end": {"dateTime": end.isoformat(), "timeZone": _TZ},
        "description": description,
        "reminders": {"useDefault": False,
                      "overrides": [{"method": "popup", "minutes": m} for m in sorted(reminders)]},
    }
    if location:
        body["location"] = location
    return body
```

**4d.** `canonical` — include `location` (absent → `None`):

```python
def canonical(body: dict) -> str:
    keep = {k: body.get(k) for k in
            ("summary", "start", "end", "description", "location", "reminders")}
    return json.dumps(keep, sort_keys=True)
```

**4e.** In `build_desired_events`, immediately after the exam `for` loop (after the line
`out[f"exam:{e['id']}"] = {"body": body, "hash": _hash(body)}`) and before `return out`, add:

```python
    sess_rem = _session_reminders()
    for e in ev.get("events", []):
        et = e.get("eventType")
        if et not in ("session", "event") or not e.get("startAt"):
            continue
        start = _parse(e["startAt"])
        if start is None or start <= now:
            continue
        end = _parse(e.get("endAt")) or start + timedelta(minutes=90)
        lines = [f"Course: {e.get('courseName') or e.get('courseLabel') or 'Program'}"]
        if e.get("instructorName"):
            lines.append(f"Instructor: {e['instructorName']}")
        if e.get("meetingLink"):
            lines.append(f"Link: {e['meetingLink']}")
        if e.get("room"):
            lines.append(f"Room: {e['room']}")
        lines.append(f"Type: {et}")
        lines.append("Source: mesa")
        body = _event_body(e.get("title") or e["id"], start, "\n".join(lines),
                           sess_rem, end=end, location=e.get("room") or None)
        out[f"{et}:{e['id']}"] = {"body": body, "hash": _hash(body)}
```

(`ev` is the already-loaded `_read_or_none(global_file("_events.json")) or {}` from the exam loop — reuse it, do not re-read.)

- [ ] **Step 5: Run the tests, verify pass**

Run: `cd scraper && uv run pytest tests/test_calendar_sync.py -v`
Expected: PASS (all — new + existing exam/assignment/reconcile/`ensure_calendar`/import-isolation).

- [ ] **Step 6: Full suite**

Run: `cd scraper && uv run pytest -q` → expect prior count + 4 new tests.
Run: `cd mcp && npx vitest run && npx tsc --noEmit && npm run build` → unchanged, green (calendar tool untouched).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "D-sessions: sync class sessions + program events to the calendar

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Live run** (data already scraped at `courses/_events.json`)

```bash
cd ~/Documents/Projects/mesa/ares-brain/scraper
H=$(cd .. && pwd)
ARES_BRAIN_HOME=$H uv run python lms_scrape.py calendar-sync --dry-run --json | python3 -m json.tool
ARES_BRAIN_HOME=$H uv run python lms_scrape.py calendar-sync --json | python3 -m json.tool
ARES_BRAIN_HOME=$H uv run python lms_scrape.py calendar-sync --json | python3 -m json.tool   # 2nd: all unchanged
```

Expect 1st: `created` ~150 + `updated` ~7 (the canonical-hash change on existing events).
2nd: `unchanged` == everything, `created`/`updated`/`deleted` 0.
Append `## D-sessions live run — <date>` to `docs/lms-api.md` with the counts and one
spot-checked class (IST time, room as location, prof in title). Commit that.

---

## Self-Review

**Spec coverage:** `_session_reminders` (§decisions reminders) → 4b + test. `location` on `_event_body` + `canonical` (§changes 2,3) → 4c/4d + test. session+event loop, future-only, description fields (§changes 4) → 4e + tests. docstring (§changes 5) → 4a. Fixture + key-set test update (§testing) → 1,2. Live run (§live run) → 8.

**Placeholder scan:** none — all code is literal.

**Type consistency:** `_session_reminders() -> list[int]` matches `_reminders()`. `_event_body` new kwarg is keyword-only, default `None` — existing 3 call sites unaffected. `build_desired_events` still `-> dict[str, dict]` with `{"body","hash"}` values. `canonical` still `-> str`.

**Hash-change note:** 4d alters `canonical` for ALL events (existing ones gain `"location": null`). Expected one-time `updated` on the 7 live events at first sync post-deploy — documented in the spec and Step 8. Not a bug.
