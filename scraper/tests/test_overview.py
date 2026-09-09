import json, subprocess, sys, time
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
    body = ("3. Assessment and Evaluation\n"
            "| Classroom Participation | | 10% from Mesa | |\n"
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
    assert isinstance(o["today"]["changed"], list)
    for a in o["assignments"]:
        for k in ("instructionsText", "isGroup", "cutoffAt", "allowLate",
                  "materials", "sessionRef", "prereadPaths"):
            assert k in a
    for e in o["exams"]:
        assert isinstance(e["testprepCommands"], list) and e["testprepCommands"]
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


# --- Part A: review fixes ---------------------------------------------------

def test_parse_assessment_no_header_returns_empty():
    # a table with weights but no "Assessment and Evaluation" header must not be
    # scanned as if it were the assessment block
    assert overview.parse_assessment("| Attendance |  | 90% |\n") == []


def test_exam_countdown_is_local_not_utc(corpus, monkeypatch):
    monkeypatch.setenv("TZ", "Asia/Kolkata")
    time.tzset()
    try:
        # 2026-09-09 20:00 UTC == 2026-09-10 01:30 IST; exam ex-mid is 2026-09-19
        now = datetime(2026, 9, 9, 20, 0, tzinfo=timezone.utc)
        ov = overview.build_overview(now=now)
        ex = next((e for e in ov["exams"] if e["date"] == "2026-09-19"), None)
        assert ex is not None
        assert ex["inDays"] == 9      # 19 - 10 local — the UTC subtraction gave 10
    finally:
        monkeypatch.setenv("TZ", "UTC")
        time.tzset()


def test_attendance_raw_null_tolerated(corpus):
    (corpus / "courses" / "_attendance.json").write_text('{"raw": null}')
    ov = overview.build_overview(now=NOW)
    assert isinstance(ov, dict) and "kpis" in ov and "attendance" in ov
    assert ov["attendance"] == []


def test_attendance_raw_nonlist_tolerated(corpus):
    (corpus / "courses" / "_attendance.json").write_text('{"raw": 5}')
    ov = overview.build_overview(now=NOW)
    assert "kpis" in ov and ov["attendance"] == []


def test_name_match_handles_trailing_paren():
    # identical strings ending in ")" must match (the old \b bug returned False)
    assert overview._name_match("Personal Branding (Component 1)",
                                "Personal Branding (Component 1)")


def test_grade_done_true_for_category_with_submitted_instance(corpus):
    ov = overview.build_overview(now=NOW)
    gp = next(g for g in ov["gradePicture"] if g["courseSlug"] == "sell")
    wk = next(c for c in gp["components"]
              if "Weekly" in c["name"] or "workbook" in c["name"].lower())
    assert wk["done"] is True                      # "Session 3 Nykaa Workbook" submitted
    assert any(c["done"] is False for c in gp["components"])   # "Final Project", unmatched
    part = next(c for c in gp["components"] if "Participation" in c["name"])
    assert part["done"] is None                    # participation stays tri-state None


def test_overdue_assignment_risk_not_green(corpus):
    ov = overview.build_overview(now=NOW)
    a = next(a for a in ov["assignments"] if a["title"] == "Session 2 Client Visit")
    assert a["weightPct"] is None                  # no component resolves
    assert a["risk"] >= 0.5                        # ~96h overdue — never green


def test_testprep_command_interpolated(corpus):
    ev = json.loads((corpus / "courses" / "_events.json").read_text())
    ev["events"].append({
        "id": "ex-comm", "eventType": "exam", "title": "Comm Quiz",
        "courseSlug": "comm", "courseName": "Power of Communication",
        "startAt": "2026-09-25T04:00:00.000Z", "endAt": "2026-09-25T05:00:00.000Z"})
    (corpus / "courses" / "_events.json").write_text(json.dumps(ev))
    ov = overview.build_overview(now=NOW)
    ce = next(e for e in ov["exams"] if e["name"] == "Comm Quiz")
    assert ce["testprepCommand"] == '/mesa:ares-brain-testprep "Power of Communication"'
    assert "<course>" not in ce["testprepCommand"]
    assert ce["testprepCommands"] == [
        {"course": "Power of Communication",
         "command": '/mesa:ares-brain-testprep "Power of Communication"'}]


def test_testprep_commands_all_exam_one_per_course(corpus):
    ov = overview.build_overview(now=NOW)
    mid = next(e for e in ov["exams"] if e["name"] == "Mid Term Exams")
    assert {c["course"] for c in mid["testprepCommands"]} == {
        "Power of Communication", "The Art of Selling"}


def test_testprep_exists_all_requires_every_course(corpus):
    for slug in ("comm", "sell"):
        d = corpus / "courses" / slug / "study"
        d.mkdir(parents=True, exist_ok=True)
        (d / "testprep-x.md").write_text("# tp")
    ov = overview.build_overview(now=NOW)
    mid = next(e for e in ov["exams"] if e["name"] == "Mid Term Exams")
    assert mid["testprepExists"] is True
    # remove one course's set -> the program-wide exam is no longer covered
    (corpus / "courses" / "sell" / "study" / "testprep-x.md").unlink()
    ov = overview.build_overview(now=NOW)
    mid = next(e for e in ov["exams"] if e["name"] == "Mid Term Exams")
    assert mid["testprepExists"] is False


# --- Part B: assignment enrichment ----------------------------------------

def test_html_to_text_readable():
    html = "<p>Hello</p><ol><li>Do X</li><li>Do Y</li></ol><p>Deadline <strong>29th</strong></p>"
    t = overview._html_to_text(html)
    assert "Hello" in t and "Do X" in t and "Do Y" in t and "29th" in t
    assert "<" not in t and "&nbsp;" not in t


def test_html_to_text_empty():
    assert overview._html_to_text("") == "" and overview._html_to_text(None) == ""


def test_session_ref_from_title():
    assert overview._session_ref("Session 4 Meesho Workbook") == 4
    assert overview._session_ref("Case pre-work") is None


def test_assignment_enrichment_fields(corpus):
    ov = overview.build_overview(now=NOW)
    a = next(a for a in ov["assignments"] if a["title"].startswith("Session"))
    assert isinstance(a["instructionsText"], str) and a["instructionsText"]
    assert "<" not in a["instructionsText"]
    assert a["isGroup"] is True
    assert isinstance(a["cutoffAt"], str) and a["allowLate"] is True
    assert a["materials"][0]["title"] == "Call shadowing guide"
    assert a["materials"][0]["kind"] == "file"
    assert a["sessionRef"] == 2
    assert isinstance(a["prereadPaths"], list)


def test_assignment_cutoff_null_when_same_as_due(corpus):
    raw = corpus / "courses" / "comm" / "raw" / "assignments.json"
    data = json.loads(raw.read_text())
    for row in data:
        if row["id"] == "a-pitch1":
            row["cutoffDate"] = row["dueAt"]
    raw.write_text(json.dumps(data))
    ov = overview.build_overview(now=NOW)
    p1 = next(a for a in ov["assignments"] if a["title"] == "Pitch 1")
    assert p1["cutoffAt"] is None


def test_today_due_list_is_enriched(corpus):
    ov = overview.build_overview(now=NOW)
    due = ov["today"]["dueTodayOrTomorrow"]
    p1 = next(d for d in due if d["title"] == "Pitch 1")
    for k in ("instructionsText", "isGroup", "materials", "sessionRef", "prereadPaths"):
        assert k in p1


def test_today_changed_is_name_resolved_list(corpus):
    ov = overview.build_overview(now=NOW)
    changed = ov["today"]["changed"]
    assert isinstance(changed, list)
    entry = next(c for c in changed if c["courseSlug"] == "comm")
    assert entry["courseName"] == "Power of Communication"
    assert entry["courseName"] != entry["courseSlug"]
    assert isinstance(entry["counts"], dict) and entry["counts"]


# --- Part C: final fix wave --------------------------------------------------

def test_assignment_title_falls_back_when_title_and_id_missing(corpus):
    raw = corpus / "courses" / "comm" / "raw" / "assignments.json"
    data = json.loads(raw.read_text())
    data.append({"id": None, "courseName": "Power of Communication", "title": ""})
    raw.write_text(json.dumps(data))
    o = overview.build_overview(now=NOW)  # must not raise (join() over a None title)
    untitled = [a for a in o["assignments"] if a["title"] == "Untitled"]
    assert untitled
    gp = next(g for g in o["gradePicture"] if g["courseSlug"] == "comm")
    assert "Untitled" in gp["summary"] or "still ahead" in gp["summary"]


def test_this_week_exam_title_falls_back_when_name_missing(corpus):
    ev = json.loads((corpus / "courses" / "_events.json").read_text())
    ev["events"].append({
        "id": "ex-untitled", "eventType": "exam", "title": None,
        "courseSlug": "comm", "courseName": "Power of Communication",
        "startAt": "2026-09-15T04:00:00.000Z", "endAt": "2026-09-15T05:00:00.000Z"})
    (corpus / "courses" / "_events.json").write_text(json.dumps(ev))
    o = overview.build_overview(now=NOW)
    tw = [w for w in o["thisWeek"] if w["kind"] == "exam" and w["title"] == "Untitled"]
    assert tw


def test_exam_brain_ready_false_when_no_courses(corpus):
    (corpus / "courses" / "_index.json").write_text("[]")
    ev = json.loads((corpus / "courses" / "_events.json").read_text())
    ev["events"].append({
        "id": "ex-all", "eventType": "exam", "title": "All Courses Exam",
        "courseSlug": None, "startAt": "2026-09-19T04:00:00.000Z",
        "endAt": "2026-09-19T05:00:00.000Z"})
    (corpus / "courses" / "_events.json").write_text(json.dumps(ev))
    o = overview.build_overview(now=NOW)
    ex = next(e for e in o["exams"] if e["name"] == "All Courses Exam")
    assert ex["brainReady"] is False


def test_brain_reason_parts_emitted_as_array(corpus):
    o = overview.build_overview(now=NOW)
    comm = next(b for b in o["brain"] if b["courseSlug"] == "comm")
    assert isinstance(comm["reasonParts"], list) and comm["reasonParts"]
    assert comm["reason"] == " · ".join(comm["reasonParts"])
