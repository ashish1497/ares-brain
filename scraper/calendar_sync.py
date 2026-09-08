"""Sync Mesa assignment / exam / class schedule to a dedicated 'Mesa Assignments'
Google Calendar. Auth via a user Desktop OAuth client + cached token.json
(run `lms_scrape.py calendar-auth` once). No LLM,
no LMS contact — reads courses/ off disk, writes to the Calendar API.

Deliberately does NOT import scrape_steps (that pulls in mesa_api -> .env).
"""
import hashlib
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from paths import courses_root, global_file, ensure, HOME

_SCOPES = ["https://www.googleapis.com/auth/calendar"]
_CAL_NAME = "Mesa Assignments"
_TZ = "Asia/Kolkata"
AUTH_HINT = ("run once:  cd scraper && uv run python lms_scrape.py calendar-auth\n"
             "(needs a Desktop-type OAuth client_secret.json at the repo root)")

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


def _parse(s):
    """Parse an ISO-8601 string to an aware UTC datetime, or None if unparseable
    or not a string. Naive timestamps are assumed to be UTC."""
    if not isinstance(s, str):
        return None
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


# --- auth -------------------------------------------------------------------

def _client_secret_path() -> Path:
    return Path(os.environ.get("GOOGLE_CLIENT_SECRET") or (HOME / "client_secret.json"))


def _token_path() -> Path:
    return Path(os.environ.get("GOOGLE_TOKEN") or (HOME / "token.json"))


def _creds_from_token_file():
    from google.oauth2.credentials import Credentials
    return Credentials.from_authorized_user_file(str(_token_path()), _SCOPES)


def _build_service(creds):
    from googleapiclient.discovery import build
    return build("calendar", "v3", credentials=creds, cache_discovery=False)


def _installed_app_flow(cs_path: str):
    from google_auth_oauthlib.flow import InstalledAppFlow
    return InstalledAppFlow.from_client_secrets_file(cs_path, _SCOPES)


def _service():
    if not _token_path().exists():
        return None
    try:
        creds = _creds_from_token_file()
    except Exception:  # noqa: BLE001
        return None
    if getattr(creds, "valid", False):
        pass
    elif getattr(creds, "expired", False) and getattr(creds, "refresh_token", None):
        try:
            from google.auth.transport.requests import Request
            creds.refresh(Request())
            _token_path().write_text(creds.to_json())
            os.chmod(_token_path(), 0o600)
        except Exception:  # noqa: BLE001
            return None
    else:
        return None
    try:
        return _build_service(creds)
    except Exception as exc:  # noqa: BLE001
        print(f"calendar service init failed: {exc}", file=sys.stderr)
        return None


def do_auth() -> dict:
    cs = _client_secret_path()
    if not cs.exists():
        return {"status": "error",
                "hint": f"no client_secret.json at {cs} — download a Desktop OAuth client from GCP Console"}
    try:
        conf = json.loads(cs.read_text())
    except Exception as exc:  # noqa: BLE001
        return {"status": "error", "hint": f"client_secret.json is not valid JSON: {exc}"}
    if not isinstance(conf, dict):
        return {"status": "error", "hint": "client_secret.json is not a JSON object"}
    if "installed" not in conf:
        kind = next(iter(conf), "unknown")
        return {"status": "error",
                "hint": f"client_secret.json is a '{kind}' client — create an OAuth client of type 'Desktop app' instead"}
    try:
        flow = _installed_app_flow(str(cs))
        creds = flow.run_local_server(port=0)
        _token_path().write_text(creds.to_json())
        os.chmod(_token_path(), 0o600)
    except Exception as exc:  # noqa: BLE001
        return {"status": "error", "hint": str(exc)}
    return {"status": "ok", "token": str(_token_path()), "scopes": _SCOPES}


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
        "description": "Auto-managed by mesa-course-agent. Do not hand-edit.",
    }).execute()
    state["calendarId"] = created["id"]
    return created["id"]


# --- desired events -------------------------------------------------------------------

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


def canonical(body: dict) -> str:
    keep = {k: body.get(k) for k in
            ("summary", "start", "end", "description", "location", "reminders")}
    return json.dumps(keep, sort_keys=True)


def _hash(body: dict) -> str:
    return hashlib.sha256(canonical(body).encode()).hexdigest()


def _iter_assignments():
    """Yield (assignment_dict, course_label, is_club). Course assignments then club items."""
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
        due = _parse(a["dueAt"])
        if due is None:
            continue
        title = a.get("title") or a["id"]
        prefix = "[Club] " if is_club else ""
        desc = (f"Course: {course_label}\n"
                f"Submission: {a.get('submissionType', 'n/a')}\n"
                f"Group: {'yes' if a.get('isGroup') else 'no'}\n"
                f"Source: mesa-course-agent")
        if not submitted and not is_draft and due > now:
            body = _event_body(f"{prefix}{title} — due", due, desc, rem)
            out[f"asg:{a['id']}:due"] = {"body": body, "hash": _hash(body)}
        cutoff_raw = a.get("cutoffDate")
        if cutoff_raw and cutoff_raw != a.get("dueAt") and not submitted and not is_draft:
            cut = _parse(cutoff_raw)
            if cut and cut > now:
                body = _event_body(f"{prefix}{title} — LATE CUTOFF", cut, desc, rem)
                out[f"asg:{a['id']}:cutoff"] = {"body": body, "hash": _hash(body)}

    ev = _read_or_none(global_file("_events.json")) or {}
    for e in ev.get("events", []):
        if e.get("eventType") != "exam" or not e.get("startAt"):
            continue
        start = _parse(e["startAt"])
        if start is None or start <= now:
            continue
        end = _parse(e["endAt"]) or start + timedelta(minutes=90)
        desc = f"Course: {e.get('courseName', 'Program')}\nSource: mesa-course-agent"
        body = _event_body(e.get("title") or e["id"], start, desc, EXAM_REMINDERS, end=end)
        out[f"exam:{e['id']}"] = {"body": body, "hash": _hash(body)}

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
        lines.append("Source: mesa-course-agent")
        body = _event_body(e.get("title") or e["id"], start, "\n".join(lines),
                           sess_rem, end=end, location=e.get("room") or None)
        out[f"{et}:{e['id']}"] = {"body": body, "hash": _hash(body)}

    return out


# --- reconcile + state + run ---------------------------------------------------

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


def _is_auth_error(exc) -> bool:
    if type(exc).__name__ in ("RefreshError", "DefaultCredentialsError"):
        return True
    s = str(exc)
    if "invalid_grant" in s or "invalid_scope" in s or "insufficient" in s.lower():
        return True
    return _http_status(exc) in (401, 403)


def _needs_auth_error_str(e: str) -> bool:
    return any(tok in e for tok in ("invalid_grant", "invalid_scope", "401", "403", "RefreshError"))


def run(dry_run: bool = False) -> dict:
    state = _read_state()
    prev_cal = state.get("calendarId")
    service = _service()
    if service is None:
        return {"status": "needs-auth", "hint": AUTH_HINT, "dryRun": dry_run}

    try:
        calendar_id = ensure_calendar(service, state)
    except Exception as exc:  # noqa: BLE001
        if _is_auth_error(exc):
            return {"status": "needs-auth", "hint": AUTH_HINT, "dryRun": dry_run}
        return {"status": "ok", "dryRun": dry_run, "calendarId": None,
                "created": 0, "updated": 0, "deleted": 0, "unchanged": 0,
                "errors": [f"ensure_calendar: {exc}"]}

    if prev_cal and prev_cal != calendar_id:
        state["events"] = {}

    desired = build_desired_events()
    r = reconcile(service, calendar_id, desired, state, dry_run)
    if r["errors"] and all(_needs_auth_error_str(e) for e in r["errors"]):
        return {"status": "needs-auth", "hint": AUTH_HINT, "dryRun": dry_run}
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
