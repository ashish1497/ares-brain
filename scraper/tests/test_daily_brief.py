import json, shutil, os
from datetime import datetime, timezone
from pathlib import Path
import pytest
import daily_brief

FIX = Path(__file__).parent / "fixtures" / "scrubbed" / "daily_corpus"
NOW = datetime(2026, 9, 15, 6, 0, tzinfo=timezone.utc)


@pytest.fixture
def corpus(home, monkeypatch):
    dst = home / "courses"
    shutil.rmtree(dst, ignore_errors=True)
    shutil.copytree(FIX, dst)
    monkeypatch.setenv("TZ", "UTC")
    import time; time.tzset()          # macOS: TZ change needs tzset() to take effect
    import importlib, paths, brain
    importlib.reload(paths); importlib.reload(brain); importlib.reload(daily_brief)
    return home


def test_classes_today(corpus):
    b = daily_brief.build_daily_brief(now=NOW)
    ids = [c["course"] for c in b["classesToday"]]
    assert ids == ["AI Course", "Program"]          # session + generic event, sorted by start
    ai = b["classesToday"][0]
    assert ai["room"] == "Delta" and ai["instructor"] == "Divij"
    assert ai["courseSlug"] == "ai-course"


def test_class_prereads_attached(corpus):
    b = daily_brief.build_daily_brief(now=NOW)
    ai = b["classesToday"][0]
    assert "normalized/material-fresh.md" in ai["prereadPaths"]


def test_assignments_due_window(corpus):
    b = daily_brief.build_daily_brief(now=NOW)
    by = {a["title"]: a for a in b["assignmentsDue"]}
    assert set(by) == {"Essay 1", "Club Prep", "Quiz 0"}   # <=72h; Essay 2 (>72h) excluded
    assert by["Essay 1"]["submitted"] is False
    assert by["Quiz 0"]["submitted"] is True
    assert by["Club Prep"]["isClub"] is True
    assert 0 < by["Essay 1"]["hoursAway"] <= 72


def test_overdue_window(corpus):
    b = daily_brief.build_daily_brief(now=NOW)
    titles = {a["title"] for a in b["overdue"]}
    assert titles == {"Reading Quiz"}          # 4h ago, unsubmitted; Old Worksheet (125h ago) too old
    hit = b["overdue"][0]
    assert hit["hoursAgo"] == 4.0


def test_overdue_excludes_submitted(corpus):
    (corpus / "courses" / "ai-course" / "raw" / "assignments.json").write_text(json.dumps([
        {"id": "a-overdue", "courseName": "AI Course", "title": "Reading Quiz",
         "dueAt": "2026-09-15T02:00:00.000Z", "submissionType": "any",
         "mySubmissionStatus": "submitted"},
    ]))
    b = daily_brief.build_daily_brief(now=NOW)
    assert b["overdue"] == []


def test_classes_tomorrow_only_when_requested(corpus):
    b = daily_brief.build_daily_brief(now=NOW)
    assert "classesTomorrow" not in b
    b2 = daily_brief.build_daily_brief(now=NOW, include_tomorrow=True)
    ids = [c["course"] for c in b2["classesTomorrow"]]
    assert ids == ["AI Course"]
    assert b2["classesTomorrow"][0]["start"].startswith("2026-09-16")


def test_changed_window(corpus):
    b = daily_brief.build_daily_brief(now=NOW, changed_since_hours=26)
    assert b["changed"] == {"ai-course": {"material": 1}}   # fresh counted, stale not


def test_scrape_stale_flag(corpus):
    fresh = NOW.timestamp() - 2 * 3600
    os.utime(corpus / "courses" / "_events.json", (fresh, fresh))
    assert daily_brief.build_daily_brief(now=NOW)["scrapeStale"] is False
    old = (NOW.timestamp() - 40 * 3600)
    os.utime(corpus / "courses" / "_events.json", (old, old))
    assert daily_brief.build_daily_brief(now=NOW)["scrapeStale"] is True


def test_scrape_stale_independent_of_changed_window(corpus):
    fresh = NOW.timestamp() - 2 * 3600
    os.utime(corpus / "courses" / "_events.json", (fresh, fresh))
    b = daily_brief.build_daily_brief(now=NOW, changed_since_hours=1)
    assert b["scrapeStale"] is False


def test_bad_course_tolerated(corpus):
    (corpus / "courses" / "broken-course" / "normalized").mkdir(parents=True)
    (corpus / "courses" / "broken-course" / "normalized" / "x.md").write_text("no frontmatter")
    b = daily_brief.build_daily_brief(now=NOW)
    assert b["changed"] == {"ai-course": {"material": 1}}


def test_malformed_events_json_tolerated(corpus):
    (corpus / "courses" / "_events.json").write_text("[1, 2, 3]")
    b = daily_brief.build_daily_brief(now=NOW)
    assert b["classesToday"] == []
    assert {a["title"] for a in b["assignmentsDue"]} == {"Essay 1", "Club Prep", "Quiz 0"}
    assert b["changed"] == {"ai-course": {"material": 1}}


def test_malformed_assignments_json_tolerated(corpus):
    (corpus / "courses" / "ai-course" / "raw" / "assignments.json").write_text('{"x": 1}')
    b = daily_brief.build_daily_brief(now=NOW)
    titles = {a["title"] for a in b["assignmentsDue"]}
    assert "Essay 1" not in titles and "Club Prep" in titles


def test_assignment_dedupe(corpus):
    dup = [{"id": "club-soon", "courseName": "AI Course", "title": "Club Prep",
            "dueAt": "2026-09-16T18:00:00.000Z", "submissionType": "any"}]
    (corpus / "courses" / "ai-course" / "raw" / "assignments.json").write_text(json.dumps(dup))
    b = daily_brief.build_daily_brief(now=NOW)
    hits = [a for a in b["assignmentsDue"] if a["title"] == "Club Prep"]
    assert len(hits) == 1
    assert hits[0]["isClub"] is False


def test_import_isolation():
    import subprocess, sys
    code = ("import daily_brief, sys; "
            "bad = {'mesa_api','scrape_steps','calendar_sync','dotenv','requests'} & set(sys.modules); "
            "sys.exit(1 if bad else 0)")
    r = subprocess.run([sys.executable, "-c", code], cwd=Path(__file__).parent.parent,
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr
