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


def test_parse_assessment_section_boundary_with_pipes():
    # real outlines lead the numbered heading with pipe cells: "|  | 4. ... |"
    body = ("|  | 3. Assessment and Evaluation |  |\n"
            "|  | Written Communication |  | 40% |\n"
            "|  | 4. Class Rules |  |\n"
            "|  | Attendance |  | 90% |\n")
    got = {c["name"]: c["weightPct"] for c in overview.parse_assessment(body)}
    assert got == {"Written Communication": 40}   # "Attendance 90%" is past the boundary


def test_parse_assessment_nested_breakdown_uses_parent_total():
    body = ("3. Assessment and Evaluation\n"
            "| Personal Branding | Personal Branding: 60% |\n"
            "| Sub A | (Elevator Pitch): 30% |\n"
            "| Sub B | (Brand Deck): 30% |\n"
            "4. Schedule\n")
    comps = overview.parse_assessment(body)
    assert sum(c["weightPct"] for c in comps) == 60   # not 60 + 30 + 30
    assert any(c["name"] == "Personal Branding" for c in comps)


def test_parse_assessment_keeps_parenthetical_qualifier():
    body = ("3. Assessment and Evaluation\n"
            "| Personal Branding (Component 1): 40% |\n")
    got = {c["name"]: c["weightPct"] for c in overview.parse_assessment(body)}
    assert got == {"Personal Branding (Component 1)": 40}


def test_attendance_runway_math():
    # attended 6 of 8, 2 sessions before midterm, 3 before endterm
    r = overview.attendance_runway({"attended": 6, "total": 8, "avgCp": 7.5},
                                   sessions_to_mid=2, sessions_to_end=3, minimum=75)
    assert r["nowPct"] == 75.0
    assert r["bestCaseMidtermPct"] == 80   # (6+2)/(8+2)
    assert r["bestCaseEndtermPct"] == 82   # (6+3)/(8+3) = 81.8 -> 82
    assert r["floorEndtermPct"] == 55      # 6/(8+3)
    assert r["state"] == "watch"           # nowPct 75 == minimum
    assert r["atRisk"] is True


def test_attendance_runway_at_risk():
    r = overview.attendance_runway({"attended": 1, "total": 4, "avgCp": 6.0},
                                   sessions_to_mid=1, sessions_to_end=3, minimum=75)
    assert r["bestCaseEndtermPct"] == 57   # (1+3)/(4+3)
    assert r["state"] == "risk"
    assert r["atRisk"] is True


def test_attendance_runway_ok():
    # 9 of 10 now, +3 to midterm, +5 to endterm — clears comfortably
    r = overview.attendance_runway({"attended": 9, "total": 10, "avgCp": 8.0},
                                   sessions_to_mid=3, sessions_to_end=5, minimum=75)
    assert r["nowPct"] == 90.0
    assert r["bestCaseEndtermPct"] == 93   # (9+5)/(10+5)
    assert r["state"] == "ok"
    assert r["atRisk"] is False
    assert r["note"] == ""


def test_attendance_runway_finished_course_ok():
    # term over for this course (0 sessions left), sitting at 100% — no risk, no note
    r = overview.attendance_runway({"attended": 2, "total": 2}, 0, 0, minimum=75)
    assert r["state"] == "ok"
    assert r["note"] == ""
    assert r["atRisk"] is False


def test_attendance_runway_finished_course_below_minimum():
    r = overview.attendance_runway({"attended": 1, "total": 2}, 0, 0, minimum=75)
    assert r["state"] == "risk"
    assert r["atRisk"] is True
    assert "finished at 50%" in r["note"]


def test_attendance_runway_early_perfect_not_watch():
    # 2 of 2 held, +8 sessions ahead — one hypothetical miss would math to 67%,
    # but with only 2 conducted that is denominator noise, not a trend. state: ok.
    r = overview.attendance_runway({"attended": 2, "total": 2}, 2, 8, minimum=75)
    assert r["nowPct"] == 100.0
    assert r["state"] == "ok"
    assert r["note"] == ""


def test_attendance_runway_one_miss_watch_after_four_held():
    # 7 of 9 = 77.8% now; one more miss -> 7/10 = 70% < 75, and 9 sessions is
    # enough history for that to signal a trend. state: watch.
    r = overview.attendance_runway({"attended": 7, "total": 9}, 4, 8, minimum=75)
    assert r["state"] == "watch"
    assert "one more miss" in r["note"]


def test_attendance_runway_bad_values_default_to_zero():
    r = overview.attendance_runway({"attended": "n/a", "total": None},
                                   sessions_to_mid=0, sessions_to_end=2, minimum=75)
    assert r["attended"] == 0 and r["conducted"] == 0
    assert r["nowPct"] == 0.0
    assert r["state"] == "watch"   # at 0 now, but 2 sessions could lift it


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
    assert comm["state"] == "watch"        # 6/8 == minimum, best case clears
    sell = next(a for a in o["attendance"] if a["courseSlug"] == "sell")
    assert sell["state"] == "risk"
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


def test_bad_attendance_row_skipped_good_row_survives(corpus):
    att = json.loads((corpus / "courses" / "_attendance.json").read_text())
    att["raw"].insert(0, {"courseId": "c-comm", "attended": "n/a", "total": 8})
    (corpus / "courses" / "_attendance.json").write_text(json.dumps(att))
    o = overview.build_overview(now=NOW)      # must not raise
    for k in ("kpis", "attendance", "exams", "gaps", "brain"):
        assert k in o
    sell = next(a for a in o["attendance"] if a["courseSlug"] == "sell")
    assert sell["attended"] == 1             # the good row is still present


def test_weight_match_is_word_bounded(corpus):
    raw = corpus / "courses" / "comm" / "raw" / "assignments.json"
    data = json.loads(raw.read_text())
    data.append({"id": "a-p10", "courseName": "Power of Communication",
                 "title": "Pitch 10", "mySubmissionStatus": "submitted"})
    raw.write_text(json.dumps(data))
    o = overview.build_overview(now=NOW)
    gp = next(g for g in o["gradePicture"] if g["courseSlug"] == "comm")
    p1 = next(c for c in gp["components"] if c["name"] == "Pitch 1")
    assert p1["done"] is None                # "Pitch 10" must not satisfy "Pitch 1"


def test_testprep_exists_scoped_to_exam_course(corpus):
    ev = json.loads((corpus / "courses" / "_events.json").read_text())
    ev["events"].append({
        "id": "ex-comm", "eventType": "exam", "title": "Comm Quiz",
        "courseSlug": "comm", "courseName": "Power of Communication",
        "startAt": "2026-09-25T04:00:00.000Z", "endAt": "2026-09-25T05:00:00.000Z"})
    (corpus / "courses" / "_events.json").write_text(json.dumps(ev))
    sd = corpus / "courses" / "sell" / "study"
    sd.mkdir(parents=True, exist_ok=True)
    (sd / "testprep-x.md").write_text("# tp")
    o = overview.build_overview(now=NOW)
    ce = next(e for e in o["exams"] if e["name"] == "Comm Quiz")
    assert ce["courses"] == ["comm"]
    assert ce["testprepExists"] is False     # the set is in a different course


def test_overview_import_isolation():
    code = ("import overview, sys; "
            "bad={'mesa_api','scrape_steps','calendar_sync','dotenv','requests'} & set(sys.modules); "
            "sys.exit(1 if bad else 0)")
    r = subprocess.run([sys.executable, "-c", code],
                       cwd=Path(__file__).parent.parent, capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr
