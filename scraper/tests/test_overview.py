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
    assert gp["aheadPct"] == 100
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
