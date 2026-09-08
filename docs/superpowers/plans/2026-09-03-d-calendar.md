# Sub-project D — Calendar Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep a dedicated agent-owned "Mesa Assignments" Google Calendar in full sync with unsubmitted assignment due dates, late-cutoff dates, club-assignment deadlines, and exam events — each event carrying a 24h + 2h popup reminder.

**Architecture:** A pure-Python `scraper/calendar_sync.py` builds the desired-event set from `courses/` on disk (no network), then reconciles it against a `courses/_calendar.json` state file via the Google Calendar API using `gcloud` Application Default Credentials. An MCP tool + `/mesa:ares-brain-calendar-sync` command drive it. Standalone — not wired into `lms_scrape.py all`. No LLM.

**Tech Stack:** Python 3.12 (`uv` venv) + `google-api-python-client` + `google-auth`; existing TypeScript MCP server; `pytest` / `vitest`.

## Global Constraints

- Repo `~/Documents/Projects/mesa/ares-brain/`; executor creates a `d-calendar` branch off `main` first.
- **No LLM call anywhere. No `launchd` / scheduling. No touching any calendar other than "Mesa Assignments". No two-way sync** — Google is a write target, the LMS is the source of truth. (spec §1)
- **`calendar_sync.py` must NOT import `scrape_steps`** — that transitively imports `mesa_api` → `load_dotenv(.env)` + `requests`. Inline `_read_or_none` / `_write_json`. Keep imports to: stdlib, `google.*`, `googleapiclient.*`, `paths`. (spec §1)
- `.env` is a real secret — never read/printed/committed. **D does not use `.env`.** Google auth is `gcloud` ADC (`~/.config/gcloud/application_default_credentials.json`). The LMS is never contacted.
- Python only via `uv` (`cd scraper && uv run pytest`). Homebrew Python is broken here.
- `courses/` gitignored (`_calendar.json` included). Not committed: `mcp/dist/`, `mcp/node_modules/`, `scraper/.venv/`, raw `scraper/tests/fixtures/*` except `scrubbed/`. Committed fixtures synthetic, no PII.
- Resolve paths through `paths.py` (`HOME`, `course_dir`, `courses_root`, `global_file`, `ensure`). `paths.HOME` module-level, re-derived on `importlib.reload` (the `home` conftest fixture relies on this).
- Every API call individually try/excepted → `errors` list; one failure never aborts the rest.
- Calendar name EXACTLY `"Mesa Assignments"`. Calendar body `timeZone: "Asia/Kolkata"`, `description: "Auto-managed by mesa. Do not hand-edit."`.
- Event: 30-min timed, `end = deadline`, `start = deadline − 30 min`, `start.dateTime`/`end.dateTime` in UTC ISO + `timeZone: "Asia/Kolkata"`. `reminders = {useDefault: False, overrides: [{method:"popup", minutes:m} for m in REMINDERS]}`. Assignment `REMINDERS` default `[1440, 120]`, overridable via `CALENDAR_REMINDERS` env (comma-separated minutes). Exams: `[10080, 1440, 120]`.
- `sourceKey`: `f"asg:{id}:due"`, `f"asg:{id}:cutoff"`, `f"exam:{id}"`.
- State `courses/_calendar.json` = `{"calendarId": str, "syncedAt": "...Z", "events": {sourceKey: {"gcalId": str, "hash": str}}}`.
- The scoped auth command (used verbatim in the `needs-auth` hint and README): `gcloud auth application-default login --scopes=https://www.googleapis.com/auth/calendar`.

---

## File Structure

**Created:**

| Path                                               | Responsibility                                                                                                                          |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `scraper/calendar_sync.py`                         | `_read_or_none`/`_write_json` (inlined), `_service`, `ensure_calendar`, `build_desired_events`, `canonical`/`_hash`, `reconcile`, `run` |
| `scraper/tests/fixtures/scrubbed/calendar_corpus/` | a synthetic `courses/` tree: `data-course/raw/assignments.json`, `_assignments-unassigned.json`, `_events.json`                         |
| `scraper/tests/test_calendar_sync.py`              |                                                                                                                                         |
| `mcp/src/tools/calendar_sync.ts`                   | spawn `calendar-sync`                                                                                                                   |
| `mcp/test/calendar_sync.test.ts`                   |                                                                                                                                         |
| `commands/mesa:ares-brain-calendar-sync.md`        | slash command                                                                                                                           |

**Modified:** `scraper/requirements.txt` (+2 deps), `scraper/lms_scrape.py` (`calendar-sync` subcommand), `mcp/src/index.ts` (register tool), `README.md`, `docs/lms-api.md` (live-run findings).

---

## Task 1: deps, auth, `ensure_calendar`, `build_desired_events`

**Files:**

- Modify: `scraper/requirements.txt`
- Create: `scraper/calendar_sync.py`, `scraper/tests/test_calendar_sync.py`, `scraper/tests/fixtures/scrubbed/calendar_corpus/` (3 files)

**Interfaces:**

- Produces:
  - `calendar_sync._read_or_none(path: Path) -> dict | list | None`
  - `calendar_sync._service() -> object | None` — Calendar API service, or `None` when ADC creds are absent/unscoped.
  - `calendar_sync.ensure_calendar(service, state: dict) -> str` — returns the "Mesa Assignments" calendarId, creating the calendar if needed, caching into `state["calendarId"]`.
  - `calendar_sync.build_desired_events(now: datetime | None = None) -> dict[str, dict]` — `{sourceKey: {"body": <gcal event body>, "hash": <sha256 hex>}}`. Pure, no network.
  - `calendar_sync.REMINDERS_DEFAULT = [1440, 120]`, `calendar_sync.EXAM_REMINDERS = [10080, 1440, 120]`.

- [ ] **Step 1: Add dependencies**

Append to `scraper/requirements.txt`:

```
google-api-python-client>=2.100.0
google-auth>=2.30.0
```

Run: `cd scraper && uv pip install -r requirements.txt`
Expected: installs `google-api-python-client`, `google-auth`, `googleapis-common-protos`, etc.

- [ ] **Step 2: Create the fixture corpus**

`scraper/tests/fixtures/scrubbed/calendar_corpus/data-course/raw/assignments.json` — all `id`s invented, all dates chosen relative to a FIXED `now = 2026-09-10T00:00:00Z` the tests pass in:

```json
[
  {
    "id": "a-sub",
    "title": "Submitted One",
    "courseName": "Data Course",
    "dueAt": "2026-09-15T11:30:00.000Z",
    "cutoffDate": null,
    "submissionType": "file",
    "isGroup": false,
    "mySubmissionStatus": "submitted",
    "status": "published"
  },
  {
    "id": "a-fut",
    "title": "Future Workbook",
    "courseName": "Data Course",
    "dueAt": "2026-09-20T11:30:00.000Z",
    "cutoffDate": null,
    "submissionType": "link",
    "isGroup": true,
    "mySubmissionStatus": null,
    "status": "published"
  },
  {
    "id": "a-cut",
    "title": "Has Cutoff",
    "courseName": "Data Course",
    "dueAt": "2026-09-18T11:30:00.000Z",
    "cutoffDate": "2026-09-19T17:00:00.000Z",
    "submissionType": "file",
    "isGroup": false,
    "mySubmissionStatus": null,
    "status": "published"
  },
  {
    "id": "a-past",
    "title": "Past Due",
    "courseName": "Data Course",
    "dueAt": "2026-09-01T11:30:00.000Z",
    "cutoffDate": null,
    "submissionType": "file",
    "isGroup": false,
    "mySubmissionStatus": null,
    "status": "published"
  },
  {
    "id": "a-draft",
    "title": "Draft Assignment",
    "courseName": "Data Course",
    "dueAt": "2026-09-25T11:30:00.000Z",
    "cutoffDate": null,
    "submissionType": "file",
    "isGroup": false,
    "mySubmissionStatus": null,
    "status": "draft"
  }
]
```

`scraper/tests/fixtures/scrubbed/calendar_corpus/_assignments-unassigned.json`:

```json
[
  {
    "id": "club-1",
    "title": "Club Prework",
    "courseName": null,
    "courseTitle": null,
    "dueAt": "2026-09-22T06:30:00.000Z",
    "cutoffDate": null,
    "mySubmissionStatus": null,
    "status": "published"
  },
  {
    "id": "club-done",
    "title": "Club Done",
    "courseName": null,
    "courseTitle": null,
    "dueAt": "2026-09-23T06:30:00.000Z",
    "cutoffDate": null,
    "mySubmissionStatus": "submitted",
    "status": "published"
  }
]
```

`scraper/tests/fixtures/scrubbed/calendar_corpus/_events.json`:

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
      "title": "A class",
      "startAt": "2026-09-20T04:00:00.000Z"
    }
  ]
}
```

Confirm not gitignored: `cd scraper && git check-ignore tests/fixtures/scrubbed/calendar_corpus/_events.json; echo "exit $?"` → `exit 1`.

- [ ] **Step 3: Write the failing test `scraper/tests/test_calendar_sync.py` (Task-1 portion)**

```python
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
import pytest
import calendar_sync

FIX = Path(__file__).parent / "fixtures" / "scrubbed" / "calendar_corpus"
NOW = datetime(2026, 9, 10, tzinfo=timezone.utc)


@pytest.fixture
def corpus(home):
    """Lay the fixture corpus into a temp ARES_BRAIN_HOME."""
    dst = home / "courses"
    shutil.rmtree(dst)
    shutil.copytree(FIX, dst)
    import importlib, paths
    importlib.reload(paths); importlib.reload(calendar_sync)
    return home


def test_build_desired_event_keys(corpus):
    d = calendar_sync.build_desired_events(now=NOW)
    assert set(d) == {"asg:a-fut:due", "asg:a-cut:due", "asg:a-cut:cutoff",
                      "asg:club-1:due", "exam:ex-fut"}
    # excluded: a-sub (submitted), a-past (past), a-draft (draft),
    #           club-done (submitted), ex-past (past), sess-1 (not an exam)


def test_due_event_body(corpus):
    d = calendar_sync.build_desired_events(now=NOW)
    b = d["asg:a-fut:due"]["body"]
    assert b["summary"] == "Future Workbook — due"
    assert b["end"]["dateTime"] == "2026-09-20T11:30:00+00:00"
    assert b["start"]["dateTime"] == "2026-09-20T11:00:00+00:00"
    assert b["end"]["timeZone"] == "Asia/Kolkata"
    assert b["reminders"]["useDefault"] is False
    assert {o["minutes"] for o in b["reminders"]["overrides"]} == {1440, 120}
    assert "Course: Data Course" in b["description"]
    assert "Group: yes" in b["description"]


def test_cutoff_event(corpus):
    d = calendar_sync.build_desired_events(now=NOW)
    assert d["asg:a-cut:cutoff"]["body"]["summary"] == "Has Cutoff — LATE CUTOFF"
    assert d["asg:a-cut:cutoff"]["body"]["end"]["dateTime"] == "2026-09-19T17:00:00+00:00"


def test_club_event_prefix(corpus):
    d = calendar_sync.build_desired_events(now=NOW)
    b = d["asg:club-1:due"]["body"]
    assert b["summary"] == "[Club] Club Prework — due"
    assert "Course: Club / Leader" in b["description"]


def test_exam_event(corpus):
    d = calendar_sync.build_desired_events(now=NOW)
    b = d["exam:ex-fut"]["body"]
    assert b["summary"] == "Mid Term Exam"
    assert b["start"]["dateTime"] == "2026-09-19T08:30:00+00:00"
    assert b["end"]["dateTime"] == "2026-09-19T11:30:00+00:00"
    assert {o["minutes"] for o in b["reminders"]["overrides"]} == {10080, 1440, 120}


def test_reminders_env_override(corpus, monkeypatch):
    monkeypatch.setenv("CALENDAR_REMINDERS", "1440")
    import importlib
    importlib.reload(calendar_sync)
    d = calendar_sync.build_desired_events(now=NOW)
    assert {o["minutes"] for o in d["asg:a-fut:due"]["body"]["reminders"]["overrides"]} == {1440}


def test_service_none_without_creds(monkeypatch):
    from google.auth.exceptions import DefaultCredentialsError
    monkeypatch.setattr(calendar_sync, "_default_creds",
                        lambda: (_ for _ in ()).throw(DefaultCredentialsError("no adc")))
    assert calendar_sync._service() is None
```

- [ ] **Step 4: Run it, verify failure**

Run: `cd scraper && uv run pytest tests/test_calendar_sync.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'calendar_sync'`

- [ ] **Step 5: Write `scraper/calendar_sync.py` (Task-1 portion)**

```python
"""Sync Mesa assignment/exam deadlines to a dedicated 'Mesa Assignments'
Google Calendar. Auth via gcloud Application Default Credentials. No LLM,
no LMS contact — reads courses/ off disk, writes to the Calendar API.

Deliberately does NOT import scrape_steps (that pulls in mesa_api -> .env).
"""
import hashlib
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from paths import courses_root, global_file, ensure

_SCOPES = ["https://www.googleapis.com/auth/calendar"]
_CAL_NAME = "Mesa Assignments"
_TZ = "Asia/Kolkata"
AUTH_HINT = ("run: gcloud auth application-default login "
             "--scopes=https://www.googleapis.com/auth/calendar")

REMINDERS_DEFAULT = [1440, 120]
EXAM_REMINDERS = [10080, 1440, 120]


def _reminders() -> list[int]:
    raw = os.environ.get("CALENDAR_REMINDERS")
    if not raw:
        return REMINDERS_DEFAULT
    try:
        return [int(x) for x in raw.split(",") if x.strip()]
    except ValueError:
        return REMINDERS_DEFAULT


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _read_or_none(path: Path):
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return None


def _write_json(path: Path, data) -> None:
    ensure(path.parent)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=1))
    tmp.replace(path)


def _parse(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


# --- auth -------------------------------------------------------------------

def _default_creds():
    import google.auth
    creds, _project = google.auth.default(scopes=_SCOPES)
    return creds


def _service():
    try:
        creds = _default_creds()
    except Exception:  # noqa: BLE001  (DefaultCredentialsError etc.)
        return None
    try:
        from googleapiclient.discovery import build
        return build("calendar", "v3", credentials=creds, cache_discovery=False)
    except Exception:  # noqa: BLE001
        return None


# --- calendar -------------------------------------------------------------------

def ensure_calendar(service, state: dict) -> str:
    cid = state.get("calendarId")
    if cid:
        try:
            service.calendarList().get(calendarId=cid).execute()
            return cid
        except Exception:  # noqa: BLE001  (deleted / not subscribed)
            state.pop("calendarId", None)

    page = None
    while True:
        resp = service.calendarList().list(pageToken=page).execute()
        for item in resp.get("items", []):
            if item.get("summary") == _CAL_NAME:
                state["calendarId"] = item["id"]
                return item["id"]
        page = resp.get("nextPageToken")
        if not page:
            break

    created = service.calendars().insert(body={
        "summary": _CAL_NAME, "timeZone": _TZ,
        "description": "Auto-managed by mesa. Do not hand-edit.",
    }).execute()
    state["calendarId"] = created["id"]
    return created["id"]


# --- desired events -------------------------------------------------------------------

def _event_body(summary: str, deadline: datetime, description: str,
                reminders: list[int], *, end: datetime | None = None) -> dict:
    end = end or deadline
    start = deadline - timedelta(minutes=30) if end == deadline else deadline
    return {
        "summary": summary,
        "start": {"dateTime": start.isoformat(), "timeZone": _TZ},
        "end": {"dateTime": end.isoformat(), "timeZone": _TZ},
        "description": description,
        "reminders": {"useDefault": False,
                      "overrides": [{"method": "popup", "minutes": m} for m in reminders]},
    }


def canonical(body: dict) -> str:
    keep = {k: body[k] for k in ("summary", "start", "end", "description", "reminders")}
    return json.dumps(keep, sort_keys=True)


def _hash(body: dict) -> str:
    return hashlib.sha256(canonical(body).encode()).hexdigest()


def _iter_assignments():
    """Yield (assignment_dict, course_label). Course assignments then club items."""
    root = courses_root()
    if root.exists():
        for d in sorted(root.iterdir()):
            if not d.is_dir() or d.name.startswith("_"):
                continue
            for a in _read_or_none(d / "raw" / "assignments.json") or []:
                yield a, (a.get("courseName") or "Course"), False
    for a in _read_or_none(global_file("_assignments-unassigned.json")) or []:
        yield a, "Club / Leader", True


def build_desired_events(now: datetime | None = None) -> dict[str, dict]:
    now = now or datetime.now(timezone.utc)
    rem = _reminders()
    out: dict[str, dict] = {}

    for a, course_label, is_club in _iter_assignments():
        if not a.get("dueAt"):
            continue
        submitted = a.get("mySubmissionStatus") == "submitted"
        is_draft = a.get("status") == "draft"
        try:
            due = _parse(a["dueAt"])
        except ValueError:
            continue
        title = a.get("title") or a["id"]
        prefix = "[Club] " if is_club else ""
        desc = (f"Course: {course_label}\n"
                f"Submission: {a.get('submissionType', 'n/a')}\n"
                f"Group: {'yes' if a.get('isGroup') else 'no'}\n"
                f"Source: mesa")
        if not submitted and not is_draft and due > now:
            body = _event_body(f"{prefix}{title} — due", due, desc, rem)
            out[f"asg:{a['id']}:due"] = {"body": body, "hash": _hash(body)}
        cutoff_raw = a.get("cutoffDate")
        if cutoff_raw and cutoff_raw != a.get("dueAt") and not submitted and not is_draft:
            try:
                cut = _parse(cutoff_raw)
            except ValueError:
                cut = None
            if cut and cut > now:
                body = _event_body(f"{prefix}{title} — LATE CUTOFF", cut, desc, rem)
                out[f"asg:{a['id']}:cutoff"] = {"body": body, "hash": _hash(body)}

    ev = _read_or_none(global_file("_events.json")) or {}
    for e in ev.get("events", []):
        if e.get("eventType") != "exam" or not e.get("startAt"):
            continue
        try:
            start = _parse(e["startAt"])
        except ValueError:
            continue
        if start <= now:
            continue
        end = _parse(e["endAt"]) if e.get("endAt") else start + timedelta(minutes=90)
        desc = f"Course: {e.get('courseName', 'Program')}\nSource: mesa"
        body = _event_body(e.get("title") or e["id"], start, desc, EXAM_REMINDERS, end=end)
        out[f"exam:{e['id']}"] = {"body": body, "hash": _hash(body)}

    return out
```

> The `_event_body` `start` logic: for assignment/cutoff events `end == deadline` so `start = deadline − 30min`. For exams, the caller passes `end=<real end>` which is `!= deadline`, so `start = deadline` (the real `startAt`). The test asserts both.

- [ ] **Step 6: Run the tests, verify pass**

Run: `cd scraper && uv run pytest tests/test_calendar_sync.py -v`
Expected: PASS (8). If `google.auth` import fails at collection time, ensure Step 1 installed it into the venv.

- [ ] **Step 7: Commit**

```bash
git add scraper/requirements.txt scraper/calendar_sync.py scraper/tests/test_calendar_sync.py scraper/tests/fixtures/scrubbed/calendar_corpus/
git commit -m "D task 1: calendar deps, ADC auth, ensure_calendar, build_desired_events

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: `reconcile` + `_calendar.json` state + `run` + `--dry-run`

**Files:**

- Modify: `scraper/calendar_sync.py`, `scraper/tests/test_calendar_sync.py`

**Interfaces:**

- Consumes: `build_desired_events`, `ensure_calendar`, `_service`.
- Produces:
  - `calendar_sync.reconcile(service, calendar_id: str, desired: dict, state: dict, dry_run: bool = False) -> dict` → `{"created": [...], "updated": [...], "deleted": [...], "unchanged": [...], "errors": [...]}`. Mutates `state["events"]` (unless `dry_run`).
  - `calendar_sync._state_path() -> Path` → `courses/_calendar.json`.
  - `calendar_sync.run(dry_run: bool = False) -> dict` → `{"status": "ok" | "needs-auth", "hint"?: str, "calendarId"?: str, "dryRun": bool, "created": int, "updated": int, "deleted": int, "unchanged": int, "errors": [...]}` (counts, not lists, in the `run` summary). Writes `courses/_calendar.json` unless `dry_run` or `needs-auth`.

- [ ] **Step 1: Add failing tests to `scraper/tests/test_calendar_sync.py`**

```python
class FakeEvents:
    def __init__(self, store, calls, fail_on=None):
        self.store, self.calls, self.fail_on = store, calls, fail_on
        self._n = 0

    def insert(self, calendarId, body):
        self.calls.append(("insert", body["summary"]))
        if self.fail_on == "insert":
            raise RuntimeError("insert boom")
        self._n += 1
        eid = f"ev{self._n}"
        self.store[eid] = body
        return _Exec({"id": eid})

    def patch(self, calendarId, eventId, body):
        self.calls.append(("patch", eventId))
        self.store[eventId] = body
        return _Exec({"id": eventId})

    def delete(self, calendarId, eventId):
        self.calls.append(("delete", eventId))
        if self.fail_on == "delete-404":
            from googleapiclient.errors import HttpError
            raise HttpError(_Resp(404), b"gone")
        self.store.pop(eventId, None)
        return _Exec({})


class _Exec:
    def __init__(self, v): self.v = v
    def execute(self): return self.v


class _Resp:
    def __init__(self, status): self.status = status
    reason = "err"


class FakeService:
    def __init__(self, **kw):
        self.store, self.calls = {}, []
        self._events = FakeEvents(self.store, self.calls, kw.get("fail_on"))
    def events(self): return self._events


def _reconcile(desired, state, **kw):
    svc = FakeService(**kw)
    r = calendar_sync.reconcile(svc, "cal-1", desired, state, kw.get("dry_run", False))
    return svc, r


def test_reconcile_inserts_new():
    state = {"events": {}}
    desired = {"k1": {"body": {"summary": "One"}, "hash": "h1"},
               "k2": {"body": {"summary": "Two"}, "hash": "h2"}}
    svc, r = _reconcile(desired, state)
    assert sorted(r["created"]) == ["k1", "k2"] and not r["errors"]
    assert state["events"]["k1"]["hash"] == "h1"
    assert [c[0] for c in svc.calls] == ["insert", "insert"]


def test_reconcile_unchanged_no_call():
    state = {"events": {"k1": {"gcalId": "ev1", "hash": "h1"}}}
    desired = {"k1": {"body": {"summary": "One"}, "hash": "h1"}}
    svc, r = _reconcile(desired, state)
    assert r["unchanged"] == ["k1"] and not svc.calls


def test_reconcile_patches_changed():
    state = {"events": {"k1": {"gcalId": "ev1", "hash": "old"}}}
    desired = {"k1": {"body": {"summary": "New"}, "hash": "new"}}
    svc, r = _reconcile(desired, state)
    assert r["updated"] == ["k1"]
    assert state["events"]["k1"]["hash"] == "new"
    assert svc.calls == [("patch", "ev1")]


def test_reconcile_deletes_orphan():
    state = {"events": {"k1": {"gcalId": "ev1", "hash": "h1"},
                        "gone": {"gcalId": "ev9", "hash": "h9"}}}
    desired = {"k1": {"body": {"summary": "One"}, "hash": "h1"}}
    svc, r = _reconcile(desired, state)
    assert r["deleted"] == ["gone"] and "gone" not in state["events"]
    assert svc.calls == [("delete", "ev9")]


def test_reconcile_delete_404_is_success():
    state = {"events": {"gone": {"gcalId": "ev9", "hash": "h9"}}}
    svc, r = _reconcile({}, state, fail_on="delete-404")
    assert r["deleted"] == ["gone"] and "gone" not in state["events"] and not r["errors"]


def test_reconcile_insert_error_isolated():
    state = {"events": {}}
    desired = {"k1": {"body": {"summary": "One"}, "hash": "h1"},
               "k2": {"body": {"summary": "Two"}, "hash": "h2"}}
    svc, r = _reconcile(desired, state, fail_on="insert")
    assert len(r["errors"]) == 2 and not r["created"]      # both fail, neither aborts the other


def test_reconcile_dry_run_no_mutation(corpus):
    state = {"events": {}}
    desired = {"k1": {"body": {"summary": "One"}, "hash": "h1"}}
    svc, r = _reconcile(desired, state, dry_run=True)
    assert r["created"] == ["k1"] and not svc.calls and state["events"] == {}


def test_run_needs_auth(corpus, monkeypatch):
    monkeypatch.setattr(calendar_sync, "_service", lambda: None)
    r = calendar_sync.run()
    assert r["status"] == "needs-auth" and "gcloud" in r["hint"]
    assert not (corpus / "courses" / "_calendar.json").exists()


def test_run_ok_writes_state(corpus, monkeypatch):
    monkeypatch.setattr(calendar_sync, "_service", lambda: FakeService())
    monkeypatch.setattr(calendar_sync, "ensure_calendar", lambda s, st: st.setdefault("calendarId", "cal-1"))
    r = calendar_sync.run()
    assert r["status"] == "ok" and r["created"] >= 1 and r["dryRun"] is False
    saved = json.loads((corpus / "courses" / "_calendar.json").read_text())
    assert saved["calendarId"] == "cal-1" and saved["events"]
```

- [ ] **Step 2: Run, verify failure**

Run: `cd scraper && uv run pytest tests/test_calendar_sync.py -k "reconcile or run_" -v`
Expected: FAIL — no `reconcile` / `run`

- [ ] **Step 3: Add `reconcile` + state + `run` to `scraper/calendar_sync.py`**

```python
def _state_path() -> Path:
    return global_file("_calendar.json")


def _read_state() -> dict:
    st = _read_or_none(_state_path()) or {}
    st.setdefault("events", {})
    return st


def _http_status(exc) -> int | None:
    resp = getattr(exc, "resp", None)
    status = getattr(resp, "status", None) or getattr(exc, "status_code", None)
    try:
        return int(status) if status is not None else None
    except (TypeError, ValueError):
        return None


def reconcile(service, calendar_id: str, desired: dict, state: dict,
              dry_run: bool = False) -> dict:
    from googleapiclient.errors import HttpError
    result = {"created": [], "updated": [], "deleted": [], "unchanged": [], "errors": []}
    events = state.setdefault("events", {})

    for key, item in desired.items():
        prev = events.get(key)
        try:
            if prev is None:
                if not dry_run:
                    ev = service.events().insert(calendarId=calendar_id, body=item["body"]).execute()
                    events[key] = {"gcalId": ev["id"], "hash": item["hash"]}
                result["created"].append(key)
            elif prev.get("hash") != item["hash"]:
                if not dry_run:
                    service.events().patch(calendarId=calendar_id,
                                           eventId=prev["gcalId"], body=item["body"]).execute()
                    prev["hash"] = item["hash"]
                result["updated"].append(key)
            else:
                result["unchanged"].append(key)
        except Exception as exc:  # noqa: BLE001
            result["errors"].append(f"{key}: {exc}")

    for key in [k for k in events if k not in desired]:
        try:
            if not dry_run:
                try:
                    service.events().delete(calendarId=calendar_id,
                                            eventId=events[key]["gcalId"]).execute()
                except HttpError as he:
                    if _http_status(he) not in (404, 410):
                        raise
                del events[key]
            result["deleted"].append(key)
        except Exception as exc:  # noqa: BLE001
            result["errors"].append(f"delete {key}: {exc}")

    return result


def run(dry_run: bool = False) -> dict:
    state = _read_state()
    service = _service()
    if service is None:
        return {"status": "needs-auth", "hint": AUTH_HINT, "dryRun": dry_run}

    try:
        calendar_id = ensure_calendar(service, state)
    except Exception as exc:  # noqa: BLE001
        return {"status": "ok", "dryRun": dry_run, "calendarId": None,
                "created": 0, "updated": 0, "deleted": 0, "unchanged": 0,
                "errors": [f"ensure_calendar: {exc}"]}

    desired = build_desired_events()
    r = reconcile(service, calendar_id, desired, state, dry_run)
    if not dry_run:
        state["syncedAt"] = _now()
        state["calendarId"] = calendar_id
        _write_json(_state_path(), state)
    return {
        "status": "ok", "calendarId": calendar_id, "dryRun": dry_run,
        "created": len(r["created"]), "updated": len(r["updated"]),
        "deleted": len(r["deleted"]), "unchanged": len(r["unchanged"]),
        "errors": r["errors"],
    }
```

- [ ] **Step 4: Run the tests, verify pass**

Run: `cd scraper && uv run pytest tests/test_calendar_sync.py -v`
Expected: PASS (all — ~18)

- [ ] **Step 5: Commit**

```bash
git add scraper/calendar_sync.py scraper/tests/test_calendar_sync.py
git commit -m "D task 2: reconcile + _calendar.json state + run + dry-run

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: `calendar-sync` subcommand + MCP tool + command + README + live run

**Files:**

- Modify: `scraper/lms_scrape.py`, `scraper/tests/test_cli.py`, `mcp/src/index.ts`, `README.md`, `docs/lms-api.md`
- Create: `mcp/src/tools/calendar_sync.ts`, `mcp/test/calendar_sync.test.ts`, `commands/mesa:ares-brain-calendar-sync.md`

**Interfaces:**

- Produces:
  - `lms_scrape.py` subcommand `calendar-sync [--dry-run] [--json]` → prints `calendar_sync.run(dry_run)` result.
  - `mcp/src/tools/calendar_sync.ts`: `buildCalendarSyncArgs(args: { dryRun?: boolean }) -> string[]` = `["calendar-sync"]` + `["--dry-run"]` when `dryRun`. `calendarSyncTool` (same handler shape as `brainQueryTool`).

- [ ] **Step 1: Add the subcommand to `scraper/lms_scrape.py`**

Subparser (after the `next-session` block):

```python
    cs = sub.add_parser("calendar-sync")
    cs.add_argument("--dry-run", action="store_true")
    cs.add_argument("--json", action="store_true")
```

Dispatch (after the `next-session` branch, before `summary = _run_all(args)`):

```python
    if args.cmd == "calendar-sync":
        import calendar_sync as _cs
        result = _cs.run(dry_run=args.dry_run)
        print(json.dumps(result) if args.json else json.dumps(result, indent=1))
        return result
```

No `mesa_api` import in this branch; `calendar_sync` reads `courses/` off disk.

- [ ] **Step 2: CLI test — add to `scraper/tests/test_cli.py`**

```python
def test_cli_calendar_sync_needs_auth(home, monkeypatch):
    (home / "courses").mkdir(exist_ok=True)
    import calendar_sync, importlib, paths
    importlib.reload(paths); importlib.reload(calendar_sync)
    monkeypatch.setattr(calendar_sync, "_service", lambda: None)
    import lms_scrape
    r = lms_scrape.run(["calendar-sync", "--json"])
    assert r["status"] == "needs-auth"
```

Run: `cd scraper && uv run pytest tests/test_cli.py -k calendar -v`
Expected: PASS

- [ ] **Step 3: Write `mcp/src/tools/calendar_sync.ts`**

```ts
import { runScraper } from "../lib/python.js";

export function buildCalendarSyncArgs(args: { dryRun?: boolean } = {}): string[] {
  const argv = ["calendar-sync"];
  if (args.dryRun) argv.push("--dry-run");
  return argv;
}

export const calendarSyncTool = {
  name: "calendar_sync",
  description:
    "Sync unsubmitted assignment due dates, late-cutoff dates, club-assignment deadlines, and exam events to a dedicated 'Mesa Assignments' Google Calendar (creates it if absent). Full reconcile: creates new, updates changed, deletes submitted/past/removed. Each event gets a popup reminder 24h and 2h before. Pass dryRun to preview without writing. Needs gcloud ADC with the calendar scope.",
  inputSchema: {
    type: "object",
    properties: {
      dryRun: { type: "boolean", description: "Preview the plan without touching the calendar." },
    },
  } as const,
  async handler(args: { dryRun?: boolean } = {}) {
    const run = await runScraper(buildCalendarSyncArgs(args));
    return run.error
      ? { ok: false as const, error: run.error }
      : { ok: run.ok, summary: run.summary, stderr: run.stderr.slice(-2000) };
  },
};
```

- [ ] **Step 4: Register in `mcp/src/index.ts` + write `mcp/test/calendar_sync.test.ts`**

`index.ts` — import `calendarSyncTool`, add to the `tools` array (last).

`mcp/test/calendar_sync.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("calendar_sync tool", () => {
  it("builds argv with dryRun toggle", async () => {
    const { buildCalendarSyncArgs } = await import("../src/tools/calendar_sync.js");
    expect(buildCalendarSyncArgs({})).toEqual(["calendar-sync"]);
    expect(buildCalendarSyncArgs({ dryRun: true })).toEqual(["calendar-sync", "--dry-run"]);
  });
  it("surfaces sidecar-missing", async () => {
    process.env.CA_FAKE_NO_VENV = "1";
    const { calendarSyncTool } = await import("../src/tools/calendar_sync.js");
    const r = await calendarSyncTool.handler({});
    expect(r.ok).toBe(false);
    delete process.env.CA_FAKE_NO_VENV;
  });
});
```

Run: `cd mcp && npx vitest run && npx tsc --noEmit && npm run build`
Expected: all green, `dist/index.js` present.

- [ ] **Step 5: Write `commands/mesa:ares-brain-calendar-sync.md`**

```markdown
---
description: Sync assignment and exam deadlines to the "Mesa Assignments" Google Calendar.
---

Run the `calendar_sync` tool (pass `dryRun: true` if the user says "preview" / "dry run").

Report:

- the calendar name and whether it was just created
- created / updated / deleted / unchanged counts
- any `errors` verbatim
- if `status` is `needs-auth`, tell the user to run exactly:
  `gcloud auth application-default login --scopes=https://www.googleapis.com/auth/calendar`
  then re-run.

This command only writes to the dedicated "Mesa Assignments" calendar — never the primary calendar.
```

- [ ] **Step 6: Update `README.md`**

Add a "Calendar" section: one-time `gcloud auth application-default login --scopes=https://www.googleapis.com/auth/calendar`; then `/mesa:ares-brain-calendar-sync` (or `calendar_sync` tool). Note it's standalone (not part of `/mesa:ares-brain-course-scrape`), the calendar is agent-managed (don't hand-edit), `CALENDAR_REMINDERS` env tunes the popups (default `1440,120`), and the extra install: `cd scraper && uv pip install -r requirements.txt` now also pulls `google-api-python-client`.

- [ ] **Step 7: Live run**

```bash
gcloud auth application-default login --scopes=https://www.googleapis.com/auth/calendar   # user runs this
cd ~/Documents/Projects/mesa/ares-brain/scraper
ARES_BRAIN_HOME=$(cd .. && pwd) uv run python lms_scrape.py calendar-sync --dry-run --json | python3 -m json.tool
ARES_BRAIN_HOME=$(cd .. && pwd) uv run python lms_scrape.py calendar-sync --json | python3 -m json.tool
```

Then in Google Calendar: confirm a "Mesa Assignments" calendar appeared with the right events + reminder times. Re-run `calendar-sync` → everything `unchanged`. If a real bug surfaces (wrong times, TZ off, dup events), fix it in `calendar_sync.py` + add a regression test, re-run.

- [ ] **Step 8: Record findings in `docs/lms-api.md`**

Append `## D (calendar) live run — 2026-09-03`: how many events created, the reminder behaviour observed, whether ADC-with-scopes worked first try, any Calendar API quirk (rate limits, `calendars().insert` propagation delay), the idempotency check result.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "D task 3: calendar-sync subcommand, MCP tool, command, README, live run

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**

- §2 gcloud ADC auth, `needs-auth` with exact command → Task 1 (`_service`, `AUTH_HINT`), Task 2 (`run` needs-auth path), Task 3 (command). ✓
- §2 dedicated "Mesa Assignments" calendar, create-if-absent, cache id → Task 1 (`ensure_calendar`). ✓
- §2 what syncs (due / cutoff / club / exam, with the exclusion rules) → Task 1 (`build_desired_events`) + the fixture covering every include/exclude case. ✓
- §2 event shape (30-min timed, reminders, exam 10080, `CALENDAR_REMINDERS`) → Task 1 (`_event_body`, `_reminders`, `EXAM_REMINDERS`). ✓
- §2 full reconcile create/patch/delete, leave un-tracked events alone → Task 2 (`reconcile` iterates `state["events"]` only). ✓
- §2 `_calendar.json` state shape → Task 2. ✓
- §2 standalone, not in `all` → Task 3 (dispatch branch is before `_run_all`, never called from `_run_all`). ✓
- §2 timezone (UTC dateTime + `Asia/Kolkata`) → Task 1 (`_event_body`). ✓
- §1 no `scrape_steps` import → Task 1 (inlined `_read_or_none`/`_write_json`, import list limited). ✓
- §4 `_http_status` handles both `.resp.status` and `.status_code` → Task 2. ✓
- §6 testing (pure builder fixture with every case, hash stability, fake-service reconcile incl. 404/error-isolation/dry-run, `_service` None) → Tasks 1-2. ✓
- §6 live run → Task 3. ✓

**Placeholder scan:** none. The `_event_body` start-time branch is subtle (documented with a note after Task 1 Step 5 and asserted by `test_due_event_body` + `test_exam_event`).

**Type consistency:**

- `build_desired_events(now=None) -> dict[str, {"body", "hash"}]` — Task 1 def; Task 2 `run` + `reconcile` consume `item["body"]` / `item["hash"]`. ✓
- `reconcile(service, calendar_id, desired, state, dry_run=False) -> {"created","updated","deleted","unchanged","errors"}` (lists) — Task 2 def; `run` converts to counts for its own return. ✓
- `run(dry_run=False) -> {"status","hint"?,"calendarId"?,"dryRun","created","updated","deleted","unchanged","errors"}` (counts) — Task 2 def; Task 3 CLI + MCP tool + command consume `status`/counts/`errors`/`hint`. ✓
- `ensure_calendar(service, state) -> str`, mutates `state["calendarId"]` — Task 1 def; Task 2 `run` calls it, monkeypatched in `test_run_ok_writes_state`. ✓
- `_service() -> service | None` — Task 1 def; Task 2 `run` + all `test_run_*` monkeypatch it. ✓
- MCP: `buildCalendarSyncArgs` / `calendarSyncTool` — Task 3 def; `index.ts` imports it. ✓
- `sourceKey` formats (`asg:<id>:due`, `asg:<id>:cutoff`, `exam:<id>`) — Task 1 emits, Task 2 reconciles by, tests assert the exact set. ✓

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-03-d-calendar.md`. Per the user's standing instruction, execute **subagent-driven** (fresh subagent per task, task review after each, whole-branch review at the end).
