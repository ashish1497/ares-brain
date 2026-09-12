"""Deterministic morning-brief data: today's classes + pre-reads, assignments due
soon, what changed since the last scrape. Pure — reads courses/ off disk, no LMS
auth. The prose digest is the course-daily skill's job."""
import json
import re
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import brain
from paths import courses_root, global_file

# How old the scrape corpus may be before the brief flags it for a manual re-scrape.
# Independent of the `changed` window — a wide changed window must not mark a fresh
# corpus stale, nor a narrow one mask a genuinely old corpus.
_STALE_HOURS = 26


def _read_json(path: Path):
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None


_SESSION_RE = re.compile(r"\bsession\s*0*(\d+)\b", re.I)


def _parse(s):
    if isinstance(s, datetime):
        return s if s.tzinfo else s.replace(tzinfo=timezone.utc)
    if isinstance(s, date):
        return datetime(s.year, s.month, s.day, tzinfo=timezone.utc)
    if not isinstance(s, str):
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


# Uses the machine-local tz; the daily job is assumed to run in Mesa's tz (IST).
def _local_date(dt: datetime) -> str:
    return dt.astimezone().strftime("%Y-%m-%d")


def _prereads_for(slug, event, now, target_date) -> list[str]:
    """Pre-read paths for a class: session-matched normalized material, falling
    back to brain.next_session. Never raises."""
    try:
        m = _SESSION_RE.search(event.get("title") or "")
        if m:
            idx = int(m.group(1))
            hits = brain.query(slug, type="material", session_min=idx, session_max=idx)
            paths = [r["path"] for r in hits if r.get("path")]
            if paths:
                return paths
        ns = brain.next_session(slug, now=now)
        if ns and ns.get("startAt") and _local_date(_parse(ns["startAt"]) or now) == target_date:
            return ns.get("prereadPaths") or []
    except Exception as exc:
        print(f"daily_brief: prereads for {slug} failed: {exc}", file=sys.stderr)
        return []
    return []


def _classes_on(now: datetime, target_date: str) -> list[dict]:
    """Sessions/events whose local date == target_date (an '%Y-%m-%d' string)."""
    raw = _read_json(global_file("_events.json"))
    ev = raw.get("events") if isinstance(raw, dict) else []
    if not isinstance(ev, list):
        ev = []
    rows = []
    for e in ev:
        if not isinstance(e, dict):
            continue
        if e.get("eventType") not in ("session", "event"):
            continue
        start = _parse(e.get("startAt"))
        if start is None or _local_date(start) != target_date:
            continue
        rows.append((start, e))
    rows.sort(key=lambda t: t[0])

    out = []
    for start, e in rows:
        slug = e.get("courseSlug")
        prereads = _prereads_for(slug, e, now, target_date) if slug else []
        end = _parse(e.get("endAt"))
        out.append({
            "start": start.astimezone().isoformat(),
            "end": end.astimezone().isoformat() if end else None,
            "course": e.get("courseName") or e.get("courseLabel") or "Program",
            "courseSlug": slug,
            "room": e.get("room"),
            "instructor": e.get("instructorName"),
            "meetingLink": e.get("meetingLink"),
            "prereadPaths": prereads,
        })
    return out


def _iter_assignment_files():
    seen = set()
    root = courses_root()
    if root.exists():
        for d in sorted(root.iterdir()):
            try:
                if not d.is_dir() or d.name.startswith("_"):
                    continue
                data = _read_json(d / "raw" / "assignments.json")
                if not isinstance(data, list):
                    data = []
                for a in data:
                    if not isinstance(a, dict):
                        continue
                    if a.get("id") is not None:
                        seen.add(a["id"])
                    yield a, (a.get("courseName") or d.name), False
            except Exception as exc:
                print(f"daily_brief: assignments for {d} failed: {exc}", file=sys.stderr)
                continue
    data = _read_json(global_file("_assignments-unassigned.json"))
    if not isinstance(data, list):
        data = []
    for a in data:
        if not isinstance(a, dict) or a.get("id") in seen:
            continue
        yield a, "Club / Leader", True


def _assignments_due(now: datetime, within_hours: int) -> list[dict]:
    horizon = now + timedelta(hours=within_hours)
    out = []
    for a, course, is_club in _iter_assignment_files():
        due = _parse(a.get("dueAt"))
        if due is None or not (now < due <= horizon):
            continue
        out.append({
            "id": a.get("id"),
            "title": a.get("title") or a.get("id"),
            "course": course,
            "dueAt": due.astimezone().isoformat(),
            "hoursAway": round((due - now).total_seconds() / 3600, 1),
            "submitted": a.get("mySubmissionStatus") == "submitted",
            "isClub": is_club,
            "submissionType": a.get("submissionType", "n/a"),
        })
    out.sort(key=lambda x: x["hoursAway"])
    return out


def _overdue(now: datetime, lookback_hours: int) -> list[dict]:
    """Unsubmitted assignments whose dueAt already passed, within the lookback
    window — things the user is at risk of having missed."""
    floor = now - timedelta(hours=lookback_hours)
    out = []
    for a, course, is_club in _iter_assignment_files():
        due = _parse(a.get("dueAt"))
        if due is None or not (floor <= due < now):
            continue
        if a.get("mySubmissionStatus") == "submitted":
            continue
        out.append({
            "id": a.get("id"),
            "title": a.get("title") or a.get("id"),
            "course": course,
            "dueAt": due.astimezone().isoformat(),
            "hoursAgo": round((now - due).total_seconds() / 3600, 1),
            "isClub": is_club,
        })
    out.sort(key=lambda x: x["hoursAgo"])
    return out


def _changed(now: datetime, since_hours: int) -> dict:
    cutoff = now - timedelta(hours=since_hours)
    root = courses_root()
    out: dict[str, dict] = {}
    if not root.exists():
        return out
    for d in sorted(root.iterdir()):
        try:
            if not d.is_dir() or d.name.startswith("_"):
                continue
            nd = d / "normalized"
            if not nd.exists():
                continue
            md_files = sorted(nd.glob("*.md"))
        except Exception as exc:
            print(f"daily_brief: changed scan for {d} failed: {exc}", file=sys.stderr)
            continue
        for p in md_files:
            if p.name.startswith("_"):
                continue
            try:
                fm, _ = brain.parse_frontmatter(p.read_text(errors="replace"))
                ts = _parse(fm.get("updatedAt"))
                if ts is None or ts <= cutoff:
                    continue
                typ = fm.get("type") or "doc"
                out.setdefault(d.name, {})
                out[d.name][typ] = out[d.name].get(typ, 0) + 1
            except Exception:
                continue
    return out


# How far back an unsubmitted, already-due assignment still counts as "missed"
# rather than ancient history.
_OVERDUE_LOOKBACK_HOURS = 48


def build_daily_brief(now: datetime | None = None, *, within_hours: int = 72,
                      changed_since_hours: int = 26, include_tomorrow: bool = False) -> dict:
    now = now or datetime.now(timezone.utc)
    today = _local_date(now)
    ev_path = global_file("_events.json")
    stale = True
    if ev_path.exists():
        stale = (now.timestamp() - ev_path.stat().st_mtime) > _STALE_HOURS * 3600
    def _safe(fn, empty):
        try:
            return fn()
        except Exception as exc:
            print(f"daily_brief: {getattr(fn, '__name__', fn)} failed: {exc}", file=sys.stderr)
            return empty
    result = {
        "date": today,
        "generatedAt": now.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "classesToday": _safe(lambda: _classes_on(now, today), []),
        "assignmentsDue": _safe(lambda: _assignments_due(now, within_hours), []),
        "overdue": _safe(lambda: _overdue(now, _OVERDUE_LOOKBACK_HOURS), []),
        "changed": _safe(lambda: _changed(now, changed_since_hours), {}),
        "changedSinceHours": changed_since_hours,
        "scrapeStale": stale,
    }
    if include_tomorrow:
        tomorrow = _local_date(now + timedelta(hours=24))
        result["classesTomorrow"] = _safe(lambda: _classes_on(now, tomorrow), [])
    return result
