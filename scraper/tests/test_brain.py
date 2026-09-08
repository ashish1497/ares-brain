import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
import pytest
import brain

FIX = Path(__file__).parent / "fixtures" / "scrubbed" / "brain_corpus"


@pytest.fixture
def course(home):
    """Copy the fixture corpus into a temp ARES_BRAIN_HOME and return the slug."""
    dst = home / "courses" / "course-one"
    dst.mkdir(parents=True)
    shutil.copytree(FIX / "course-one" / "normalized", dst / "normalized")
    import importlib, paths
    importlib.reload(paths); importlib.reload(brain)
    return "course-one"


def test_parse_frontmatter():
    fm, body = brain.parse_frontmatter(
        '---\ntype: material\ntitle: "Session 1: Intro"\n---\nhello body\n')
    assert fm["type"] == "material" and fm["title"] == "Session 1: Intro"
    assert body.strip() == "hello body"
    assert brain.parse_frontmatter("no fence here") == ({}, "no fence here")
    fm2, body2 = brain.parse_frontmatter(
        '---\ntype: material\ntitle: [unclosed\n---\nbody here\n')
    assert fm2 == {}
    assert "type: material" in body2 and "body here" in body2
    fm3, _ = brain.parse_frontmatter('---\njust a string\n---\nx\n')
    assert fm3 == {}


def test_build_index_creates_table_and_meta(course, home):
    r = brain.build_index(course)
    assert r["indexed"] == 8
    db = home / "courses" / "course-one" / "brain" / "index.sqlite"
    assert db.exists()
    con = sqlite3.connect(db)
    n = con.execute("SELECT count(*) FROM docs").fetchone()[0]
    assert n == 8
    types = {r[0] for r in con.execute("SELECT DISTINCT type FROM docs")}
    assert types == {"material", "assignment", "session", "outline", "announcement", "transcript", "book"}
    meta = __import__("json").loads(
        (home / "courses" / "course-one" / "brain" / "_brain.json").read_text())
    assert meta["sourceCount"] == 8 and meta["corpusBytes"] > 5000


def test_build_index_skips_when_unchanged(course):
    brain.build_index(course)
    r2 = brain.build_index(course)
    assert r2["skipped"] is True


def test_build_index_rebuilds_after_touch(course, home):
    brain.build_index(course)
    # a hand-added file the ingest manifest doesn't list -> mtime fallback in the
    # fingerprint, so its appearance forces a rebuild.
    p = home / "courses" / "course-one" / "normalized" / "material-hand-added.md"
    p.write_text('---\ntype: material\ntitle: "Extra"\n---\nporters five forces.\n')
    r = brain.build_index(course)
    assert r["skipped"] is False


def test_query_type_filter(course):
    brain.build_index(course)
    rows = brain.query(course, type="assignment")
    assert len(rows) == 1 and rows[0]["type"] == "assignment"
    assert rows[0]["due"].startswith("2026-08-25")


def test_query_session_range(course):
    brain.build_index(course)
    rows = brain.query(course, session_min=2, session_max=2)
    paths = {r["path"] for r in rows}
    assert "normalized/session-frameworks-s2.md" in paths
    assert "normalized/material-intro-to-frameworks.md" not in paths  # session 1


def test_query_due_before(course):
    brain.build_index(course)
    rows = brain.query(course, type="assignment", due_before="2026-08-26T00:00:00Z")
    assert len(rows) == 1
    rows2 = brain.query(course, type="assignment", due_before="2026-08-24T00:00:00Z")
    assert rows2 == []


def test_query_fts_ranking(course):
    brain.build_index(course)
    rows = brain.query(course, text="unit economics contribution margin")
    assert rows, "expected FTS hits"
    # the transcript is dense with the phrase; it should outrank the outline row
    assert rows[0]["path"] == "normalized/transcript-long.md"
    assert "contribution margin" in rows[0]["snippet"].lower()


def test_query_all_courses(home):
    for slug in ("course-a", "course-b"):
        nd = home / "courses" / slug / "normalized"
        nd.mkdir(parents=True)
        (nd / "material-x.md").write_text(
            f'---\ntype: material\ntitle: "X"\ncourse: "{slug}"\n---\n'
            f'kanban and retrospectives for {slug}\n')
    import importlib, paths
    importlib.reload(paths); importlib.reload(brain)
    rows = brain.query(None, text="kanban")
    assert {r["course"] for r in rows} == {"course-a", "course-b"}


def test_query_malformed_fts_returns_empty(course):
    brain.build_index(course)
    assert brain.query(course, text='AND OR ((("') == []


def test_query_malformed_frontmatter_still_indexed(course, home):
    bad = home / "courses" / "course-one" / "normalized" / "material-bad.md"
    bad.write_text("---\ntype: material\ntitle: [unclosed\n---\nsearchable weird body\n")
    brain.build_index(course, force=True)
    rows = brain.query(course, text="searchable weird")
    assert any(r["path"].endswith("material-bad.md") for r in rows)


def test_parse_outline_structured(course):
    o = brain.parse_outline(course)
    assert o["structured"] is True
    assert o["columns"] == ["Session", "Date", "Topic", "Pre-read"]
    row3 = next(r for r in o["rows"] if r["session"] == "3")
    assert row3["topic"] == "Competitive Strategy"


def test_parse_outline_unstructured(home):
    nd = home / "courses" / "course-x" / "normalized"
    nd.mkdir(parents=True)
    (nd / "outline-outline.md").write_text(
        '---\ntype: outline\ntitle: "Outline"\ncourse: "X"\n---\n'
        '| Week | Theme |\n| --- | --- |\n| 1 | Kickoff |\n')
    import importlib, paths
    importlib.reload(paths); importlib.reload(brain)
    o = brain.parse_outline("course-x")
    assert o["structured"] is False
    assert o["rows"] == [["1", "Kickoff"]]


def _seed_attendance_events(home, slug, conducted, events):
    import json
    (home / "courses" / "_attendance.json").write_text(json.dumps(
        {"raw": [], "byCourse": {slug: {"courseId": "c", "sessionsConducted": conducted,
                                        "attended": conducted}}}))
    (home / "courses" / "_events.json").write_text(json.dumps(
        {"window": {"from": "x", "to": "y"}, "events": events}))


def test_next_session_from_events(course, home):
    _seed_attendance_events(home, "course-one", 2, [
        {"id": "e3", "eventType": "session", "courseSlug": "course-one",
         "title": "S3 Competitive Strategy",
         "startAt": "2026-09-03T04:00:00.000Z", "endAt": "2026-09-03T05:30:00.000Z"},
        {"id": "eOld", "eventType": "session", "courseSlug": "course-one",
         "title": "old", "startAt": "2026-08-01T04:00:00.000Z"},
    ])
    import importlib, paths
    importlib.reload(paths); importlib.reload(brain)
    ns = brain.next_session("course-one", now=datetime(2026, 9, 1, tzinfo=timezone.utc))
    assert ns["sessionsConducted"] == 2 and ns["nextIndex"] == 3
    assert ns["startAt"].startswith("2026-09-03")
    assert ns["source"] == "events"
    assert ns["outlineRow"]["topic"] == "Competitive Strategy"


def test_next_session_preread_paths(course, home):
    _seed_attendance_events(home, "course-one", 0, [
        {"id": "e1", "eventType": "session", "courseSlug": "course-one",
         "title": "S1 Intro", "startAt": "2026-09-05T04:00:00.000Z"},
    ])
    import importlib, paths
    importlib.reload(paths); importlib.reload(brain)
    ns = brain.next_session("course-one", now=datetime(2026, 9, 1, tzinfo=timezone.utc))
    assert ns["nextIndex"] == 1
    assert ns["prereadPaths"] == ["normalized/material-intro-to-frameworks.md"]


def test_next_session_outline_fallback(course, home):
    _seed_attendance_events(home, "course-one", 2, [])   # no events
    import importlib, paths
    importlib.reload(paths); importlib.reload(brain)
    ns = brain.next_session("course-one", now=datetime(2026, 8, 30, tzinfo=timezone.utc))
    assert ns["nextIndex"] == 3 and ns["source"] == "outline"
    assert ns["outlineRow"]["date"] == "2026-09-03"


def test_brain_status_fresh_vs_stale(course, home):
    brain.build_index(course)
    st = brain.brain_status(course)
    assert st["indexStale"] is False and st["guideBuiltAt"] is None
    assert st["guideSourcesBehind"] == 6           # nothing built yet
    p = home / "courses" / "course-one" / "normalized" / "hand-added-note.md"
    p.write_text('---\ntype: material\ntitle: "Note"\n---\nmore text\n')
    assert brain.brain_status(course)["indexStale"] is True


def test_mark_guide_then_status(course):
    brain.build_index(course)
    brain.mark_guide(course)
    st = brain.brain_status(course)
    assert st["guideBuiltAt"] is not None
    assert st["guideSourcesBehind"] == 0


def test_embeddings_recommended_threshold(course, home):
    # inflate the transcript past 150 KB
    p = home / "courses" / "course-one" / "normalized" / "transcript-long.md"
    p.write_text(p.read_text() + ("\nfiller line for size " * 8000))
    brain.build_index(course, force=True)
    assert brain.brain_status(course)["embeddingsRecommended"] is True


def test_ensure_course_md_only_when_absent(course, home):
    p = brain.ensure_course_md("course-one", "Course One")
    assert p.read_text().startswith("# Course One — my focus notes")
    p.write_text("MY EDITS")
    brain.ensure_course_md("course-one", "Course One")
    assert p.read_text() == "MY EDITS"    # never overwritten


def test_brain_module_has_no_lms_imports():
    import inspect
    src = inspect.getsource(brain)
    assert "scrape_steps" not in src
    assert "mesa_api" not in src


def test_brain_import_isolation():
    import subprocess, sys, os
    code = ("import brain, sys; "
            "bad = {'mesa_api','scrape_steps','requests','dotenv'} "
            "& {m.split('.')[0] for m in sys.modules}; "
            "assert not bad, bad")
    r = subprocess.run([sys.executable, "-c", code],
                       capture_output=True, text=True,
                       env={**os.environ, "PYTHONPATH": "."})
    assert r.returncode == 0, r.stderr


def test_corrupt_brain_json_recovers(course, home):
    bd = home / "courses" / "course-one" / "brain"
    bd.mkdir(parents=True, exist_ok=True)
    (bd / "_brain.json").write_text("{broken")
    brain.build_index(course)          # must not raise
    brain.brain_status(course)         # must not raise
    import json as _j
    assert _j.loads((bd / "_brain.json").read_text())["sourceCount"] == 8


def test_build_index_keeps_index_when_normalized_gone(course, home):
    brain.build_index(course)
    db = home / "courses" / "course-one" / "brain" / "index.sqlite"
    assert db.exists()
    shutil.rmtree(home / "courses" / "course-one" / "normalized")
    r = brain.build_index(course)
    assert r.get("reason") == "no normalized corpus"
    assert db.exists()                 # good index not destroyed


def test_query_survives_corrupt_index_db(home):
    for slug in ("course-a", "course-b"):
        nd = home / "courses" / slug / "normalized"
        nd.mkdir(parents=True)
        (nd / "material-x.md").write_text(
            f'---\ntype: material\ntitle: "X"\ncourse: "{slug}"\n---\n'
            f'kanban and retrospectives for {slug}\n')
    import importlib, paths
    importlib.reload(paths); importlib.reload(brain)
    brain.build_index("course-a")
    brain.build_index("course-b")
    (home / "courses" / "course-a" / "brain" / "index.sqlite").write_bytes(b"not a db")
    rows = brain.query(None, text="kanban")          # must not raise
    assert "course-b" in {r["course"] for r in rows}


def test_prereadpaths_from_title_when_no_session_frontmatter(course, home):
    _seed_attendance_events(home, "course-one", 2, [
        {"id": "e3", "eventType": "session", "courseSlug": "course-one",
         "title": "S3", "startAt": "2026-09-10T04:00:00.000Z"},
    ])
    nd = home / "courses" / "course-one" / "normalized"
    (nd / "material-preread-3.md").write_text(
        '---\ntype: material\ntitle: "Session 3 Pre-read: Porter"\n---\n'
        'Porter five forces reading.\n')
    import importlib, paths
    importlib.reload(paths); importlib.reload(brain)
    brain.build_index("course-one", force=True)
    ns = brain.next_session("course-one", now=datetime(2026, 9, 1, tzinfo=timezone.utc))
    assert ns["nextIndex"] == 3
    assert "normalized/material-preread-3.md" in ns["prereadPaths"]


REAL = FIX / "course-real"


@pytest.fixture
def course_real(home):
    dst = home / "courses" / "course-real"
    dst.mkdir(parents=True)
    shutil.copytree(REAL / "normalized", dst / "normalized")
    import importlib, paths
    importlib.reload(paths); importlib.reload(brain)
    return "course-real"


def test_real_shaped_outline_unstructured(course_real):
    assert brain.parse_outline("course-real")["structured"] is False


def test_real_shaped_next_session_via_events(course_real, home):
    _seed_attendance_events(home, "course-real", 1, [
        {"id": "r2", "eventType": "session", "courseSlug": "course-real",
         "title": "Value Chains", "startAt": "2026-09-20T04:00:00.000Z"},
    ])
    import importlib, paths
    importlib.reload(paths); importlib.reload(brain)
    ns = brain.next_session("course-real", now=datetime(2026, 9, 1, tzinfo=timezone.utc))
    assert ns is not None and ns["source"] == "events"
    assert ns["outlineRow"] is None


def test_real_shaped_prereadpaths_from_title(course_real, home):
    _seed_attendance_events(home, "course-real", 1, [
        {"id": "r2", "eventType": "session", "courseSlug": "course-real",
         "title": "Value Chains", "startAt": "2026-09-20T04:00:00.000Z"},
    ])
    import importlib, paths
    importlib.reload(paths); importlib.reload(brain)
    brain.build_index("course-real", force=True)
    ns = brain.next_session("course-real", now=datetime(2026, 9, 1, tzinfo=timezone.utc))
    assert ns["nextIndex"] == 2
    assert ns["prereadPaths"]


def test_next_session_none_when_no_data(home):
    (home / "courses" / "empty-course" / "normalized").mkdir(parents=True)
    import importlib, paths
    importlib.reload(paths); importlib.reload(brain)
    assert brain.next_session("empty-course") is None
