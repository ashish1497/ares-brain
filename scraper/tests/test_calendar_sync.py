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
                      "asg:club-1:due", "exam:ex-fut",
                      "session:sess-1", "event:evt-1"}
    # excluded: submitted / past / draft assignments, ex-past, sess-past (past),
    #           sess-baddate (unparseable startAt)


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


import json as _json


def test_service_none_without_token(home, monkeypatch):
    import importlib, paths
    monkeypatch.setenv("GOOGLE_TOKEN", str(home / "no-token.json"))
    importlib.reload(paths)
    import calendar_sync
    importlib.reload(calendar_sync)
    assert calendar_sync._service() is None


def test_service_builds_from_valid_token(home, monkeypatch):
    import importlib, paths
    tok = home / "token.json"
    tok.write_text('{"token":"x","refresh_token":"r","client_id":"c","client_secret":"s",'
                   '"scopes":["https://www.googleapis.com/auth/calendar"]}')
    monkeypatch.setenv("GOOGLE_TOKEN", str(tok))
    importlib.reload(paths)
    import calendar_sync
    importlib.reload(calendar_sync)

    class FakeCreds:
        valid = True
        expired = False
        refresh_token = "r"
        def to_json(self): return "{}"
    monkeypatch.setattr(calendar_sync, "_creds_from_token_file", lambda: FakeCreds())
    monkeypatch.setattr(calendar_sync, "_build_service", lambda creds: "SERVICE")
    assert calendar_sync._service() == "SERVICE"


def test_service_refreshes_expired_token(home, monkeypatch):
    import importlib, paths
    tok = home / "token.json"
    tok.write_text("{}")
    monkeypatch.setenv("GOOGLE_TOKEN", str(tok))
    importlib.reload(paths)
    import calendar_sync
    importlib.reload(calendar_sync)

    class FakeCreds:
        def __init__(self): self.valid = False; self.expired = True; self.refresh_token = "r"
        def refresh(self, _req): self.valid = True; self.expired = False
        def to_json(self): return '{"refreshed":true}'
    fc = FakeCreds()
    monkeypatch.setattr(calendar_sync, "_creds_from_token_file", lambda: fc)
    monkeypatch.setattr(calendar_sync, "_build_service", lambda creds: "SERVICE")
    assert calendar_sync._service() == "SERVICE"
    assert '"refreshed"' in tok.read_text()


def test_service_none_when_expired_no_refresh(home, monkeypatch):
    import importlib, paths
    tok = home / "token.json"; tok.write_text("{}")
    monkeypatch.setenv("GOOGLE_TOKEN", str(tok))
    importlib.reload(paths)
    import calendar_sync
    importlib.reload(calendar_sync)

    class FakeCreds:
        valid = False; expired = True; refresh_token = None
    monkeypatch.setattr(calendar_sync, "_creds_from_token_file", lambda: FakeCreds())
    assert calendar_sync._service() is None


def test_do_auth_no_client_secret(home, monkeypatch):
    import importlib, paths
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", str(home / "nope.json"))
    importlib.reload(paths)
    import calendar_sync
    importlib.reload(calendar_sync)
    r = calendar_sync.do_auth()
    assert r["status"] == "error" and "client_secret" in r["hint"]


def test_do_auth_rejects_web_client(home, monkeypatch):
    import importlib, paths
    cs = home / "client_secret.json"
    cs.write_text('{"web":{"client_id":"c","client_secret":"s"}}')
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", str(cs))
    importlib.reload(paths)
    import calendar_sync
    importlib.reload(calendar_sync)
    r = calendar_sync.do_auth()
    assert r["status"] == "error" and "Desktop" in r["hint"]


def test_do_auth_rejects_non_object_json(home, monkeypatch):
    import importlib, paths
    cs = home / "client_secret.json"
    cs.write_text('["not", "an", "object"]')
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", str(cs))
    importlib.reload(paths)
    import calendar_sync
    importlib.reload(calendar_sync)
    r = calendar_sync.do_auth()
    assert r["status"] == "error" and "JSON object" in r["hint"]


def test_do_auth_writes_token(home, monkeypatch):
    import importlib, os, paths
    cs = home / "client_secret.json"
    cs.write_text('{"installed":{"client_id":"c","client_secret":"s","redirect_uris":["http://localhost"]}}')
    tok = home / "token.json"
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", str(cs))
    monkeypatch.setenv("GOOGLE_TOKEN", str(tok))
    importlib.reload(paths)
    import calendar_sync
    importlib.reload(calendar_sync)

    class FakeFlow:
        def run_local_server(self, port=0):
            class C:
                def to_json(self): return '{"token":"granted"}'
            return C()
    monkeypatch.setattr(calendar_sync, "_installed_app_flow", lambda cs_path: FakeFlow())
    r = calendar_sync.do_auth()
    assert r["status"] == "ok"
    assert tok.read_text() == '{"token":"granted"}'
    assert oct(os.stat(tok).st_mode)[-3:] == "600"


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


class _RaiseExec:
    def __init__(self, exc): self.exc = exc
    def execute(self): raise self.exc


class FakeCalendarList:
    def __init__(self, calls, *, get_result="ok", pages=None):
        self.calls, self.get_result, self.pages = calls, get_result, list(pages or [])
        self._i = 0

    def get(self, calendarId):
        self.calls.append(("calendarList.get", calendarId))
        if isinstance(self.get_result, Exception):
            return _RaiseExec(self.get_result)
        return _Exec({"id": calendarId})

    def list(self, pageToken=None):
        self.calls.append(("calendarList.list", pageToken))
        page = self.pages[self._i] if self._i < len(self.pages) else {"items": []}
        self._i += 1
        return _Exec(page)


class FakeCalendars:
    def __init__(self, calls, *, new_id="new-cal"):
        self.calls, self.new_id = calls, new_id

    def insert(self, body):
        self.calls.append(("calendars.insert", body.get("summary")))
        return _Exec({"id": self.new_id})


class FakeService:
    def __init__(self, **kw):
        self.store, self.calls = {}, []
        self._events = FakeEvents(self.store, self.calls, kw.get("fail_on"))
        self._callist = FakeCalendarList(self.calls, get_result=kw.get("cal_get", "ok"),
                                         pages=kw.get("cal_pages"))
        self._cals = FakeCalendars(self.calls, new_id=kw.get("new_id", "new-cal"))
    def events(self): return self._events
    def calendarList(self): return self._callist
    def calendars(self): return self._cals


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
    assert len(r["errors"]) == 2 and not r["created"]


def test_reconcile_dry_run_no_mutation(corpus):
    state = {"events": {}}
    desired = {"k1": {"body": {"summary": "One"}, "hash": "h1"}}
    svc, r = _reconcile(desired, state, dry_run=True)
    assert r["created"] == ["k1"] and not svc.calls and state["events"] == {}


def test_run_needs_auth(corpus, monkeypatch):
    monkeypatch.setattr(calendar_sync, "_service", lambda: None)
    r = calendar_sync.run()
    assert r["status"] == "needs-auth" and "calendar-auth" in r["hint"]
    assert not (corpus / "courses" / "_calendar.json").exists()


def test_run_ok_writes_state(corpus, monkeypatch):
    monkeypatch.setattr(calendar_sync, "_service", lambda: FakeService())
    monkeypatch.setattr(calendar_sync, "ensure_calendar", lambda s, st: st.setdefault("calendarId", "cal-1"))
    r = calendar_sync.run()
    assert r["status"] == "ok" and r["created"] >= 1 and r["dryRun"] is False
    saved = json.loads((corpus / "courses" / "_calendar.json").read_text())
    assert saved["calendarId"] == "cal-1" and saved["events"]


# --- I1: auth-error classification -------------------------------------------

def test_run_needs_auth_on_invalid_grant(corpus, monkeypatch):
    class Boom(FakeService):
        def calendarList(self):
            raise RuntimeError("('invalid_grant: Bad Request', {'error': 'invalid_grant'})")
    monkeypatch.setattr(calendar_sync, "_service", lambda: Boom())
    r = calendar_sync.run()
    assert r["status"] == "needs-auth" and "calendar-auth" in r["hint"]
    assert not (corpus / "courses" / "_calendar.json").exists()


def test_run_needs_auth_when_all_reconcile_errors_are_auth(corpus, monkeypatch):
    monkeypatch.setattr(calendar_sync, "_service", lambda: FakeService())
    monkeypatch.setattr(calendar_sync, "ensure_calendar", lambda s, st: "cal-1")
    monkeypatch.setattr(calendar_sync, "reconcile",
                        lambda *a, **k: {"created": [], "updated": [], "deleted": [],
                                         "unchanged": [], "errors": ["asg:x:due: RefreshError bad"]})
    r = calendar_sync.run()
    assert r["status"] == "needs-auth"
    assert not (corpus / "courses" / "_calendar.json").exists()


# --- I2: recreated calendar resets events ----------------------------------

def test_run_resets_events_on_calendar_change(corpus, monkeypatch):
    (corpus / "courses" / "_calendar.json").write_text(json.dumps(
        {"calendarId": "old-cal", "events": {"asg:x:due": {"gcalId": "e1", "hash": "h1"}}}))
    import importlib, paths
    importlib.reload(paths); importlib.reload(calendar_sync)
    monkeypatch.setattr(calendar_sync, "_service", lambda: FakeService())

    def fake_ensure(service, state):
        state["calendarId"] = "new-cal"
        return "new-cal"
    monkeypatch.setattr(calendar_sync, "ensure_calendar", fake_ensure)
    calendar_sync.run()
    saved = json.loads((corpus / "courses" / "_calendar.json").read_text())
    assert "asg:x:due" not in saved["events"] or saved["events"]["asg:x:due"]["gcalId"] != "e1"


# --- I3: malformed dates are per-item isolated ----------------------------

def test_build_desired_events_skips_malformed_dates(home, monkeypatch):
    root = home / "courses" / "c1" / "raw"
    root.mkdir(parents=True)
    (root / "assignments.json").write_text(json.dumps([
        {"id": "bad-str", "title": "Bad Str", "courseName": "C1", "dueAt": "not-a-date"},
        {"id": "bad-int", "title": "Bad Int", "courseName": "C1", "dueAt": 12345},
        {"id": "good", "title": "Good", "courseName": "C1",
         "dueAt": "2999-01-01T00:00:00.000Z"},
    ]))
    (home / "courses" / "_events.json").write_text(json.dumps({"events": [
        {"id": "ex-bad-end", "eventType": "exam", "title": "Exam",
         "startAt": "2999-01-01T08:00:00.000Z", "endAt": "garbage"},
    ]}))
    import importlib, paths
    importlib.reload(paths); importlib.reload(calendar_sync)
    d = calendar_sync.build_desired_events(now=NOW)
    assert "asg:bad-str:due" not in d and "asg:bad-int:due" not in d
    assert "asg:good:due" in d
    b = d["exam:ex-bad-end"]["body"]
    assert b["start"]["dateTime"] == "2999-01-01T08:00:00+00:00"
    assert b["end"]["dateTime"] == "2999-01-01T09:30:00+00:00"


def test_run_rerun_is_noop(corpus, monkeypatch):
    monkeypatch.setattr(calendar_sync, "_service", lambda: FakeService())
    monkeypatch.setattr(calendar_sync, "ensure_calendar", lambda s, st: "cal-1")
    calendar_sync.run()
    svc = FakeService()
    monkeypatch.setattr(calendar_sync, "_service", lambda: svc)
    r = calendar_sync.run()
    assert r["created"] == 0 and r["updated"] == 0 and r["deleted"] == 0
    assert not [c for c in svc.calls if c[0] in ("insert", "patch", "delete")]


# --- I4: ensure_calendar coverage ----------------------------------------

def test_ensure_calendar_cached_hit():
    svc = FakeService()
    state = {"calendarId": "cal-1", "events": {}}
    assert calendar_sync.ensure_calendar(svc, state) == "cal-1"
    assert not [c for c in svc.calls if c[0] in ("calendarList.list", "calendars.insert")]


def test_ensure_calendar_cached_404_then_find():
    svc = FakeService(cal_get=RuntimeError("404"),
                      cal_pages=[{"items": [{"summary": "Mesa Assignments", "id": "found"}]}])
    state = {"calendarId": "stale", "events": {}}
    assert calendar_sync.ensure_calendar(svc, state) == "found"
    assert state["calendarId"] == "found"
    assert not [c for c in svc.calls if c[0] == "calendars.insert"]


def test_ensure_calendar_creates_when_absent():
    svc = FakeService(cal_pages=[{"items": [{"summary": "Other", "id": "x"}]}], new_id="created-1")
    state = {"events": {}}
    assert calendar_sync.ensure_calendar(svc, state) == "created-1"
    assert ("calendars.insert", "Mesa Assignments") in svc.calls


def test_ensure_calendar_pagination():
    svc = FakeService(cal_pages=[
        {"items": [{"summary": "Nope", "id": "n"}], "nextPageToken": "p2"},
        {"items": [{"summary": "Mesa Assignments", "id": "page2"}]},
    ])
    state = {"events": {}}
    assert calendar_sync.ensure_calendar(svc, state) == "page2"


# --- I5: import isolation -------------------------------------------------

def test_calendar_sync_import_isolation():
    import subprocess, sys, os
    code = ("import calendar_sync, sys; "
            "bad = {'mesa_api','scrape_steps','requests','dotenv','google','googleapiclient'} "
            "& {m.split('.')[0] for m in sys.modules}; "
            "assert not bad, bad")
    r = subprocess.run([sys.executable, "-c", code],
                       capture_output=True, text=True,
                       env={**os.environ, "PYTHONPATH": "."})
    assert r.returncode == 0, r.stderr
