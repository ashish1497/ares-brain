import json


def _scrubbed_get(scrubbed, path, params=None):
    table = {
        "/users/me": {"user": {"id": "stu-1"}},
        "/attendance/student/summary": scrubbed("attendance_summary.json")["data"],
        "/curriculum/courses": scrubbed("courses_term1.json")["data"],
        "/assignments/my": scrubbed("assignments_my.json")["data"],
        "/events/my": scrubbed("events_my.json")["data"],
    }
    if path in table:
        return table[path]
    if path == "/assignments":
        return {"assignments": []}
    if path == "/curriculum/topics":
        return scrubbed("topics.json")["data"]
    if path.endswith("/materials"):
        return {"materials": [
            {"id": "seed-mat", "kind": "text", "title": "Seed material",
             "content": "<p>hello <a href='https://x.test'>link</a></p>"}]}
    if path.endswith("/recordings"):
        return {"recordings": []}
    if path == "/announcements":
        return scrubbed("announcements.json")["data"] if (params or {}).get("page", 1) == 1 else {"announcements": []}
    return {}


_A = "id-course-a"
_B = "id-course-b"


def _two_course_get(path, params=None):
    if path == "/users/me":
        return {"user": {"id": "stu-1"}}
    if path == "/attendance/student/summary":
        return [
            {"courseId": _A, "courseName": "Course A", "termId": "t1",
             "termName": "Term 1", "total": 4, "attended": 3,
             "percentage": 75, "avgCp": 0},
            {"courseId": _B, "courseName": "Course B", "termId": "t1",
             "termName": "Term 1", "total": 2, "attended": 1,
             "percentage": 50, "avgCp": 0},
        ]
    if path == "/curriculum/courses":
        return {"courses": [{"id": _A, "title": "Course A"},
                            {"id": _B, "title": "Course B"}]}
    if path == "/assignments/my" or path == "/assignments":
        return {"assignments": []}
    if path == "/curriculum/topics":
        return {"topics": []}
    if path == "/events/my":
        return {"events": []}
    if path == "/announcements":
        if (params or {}).get("page", 1) == 1:
            return {"announcements": [
                {"id": "ann-1", "courseId": None, "title": "Program note",
                 "publishedAt": "2026-08-20T00:00:00Z"}]}
        return {"announcements": []}
    if path.endswith("/materials"):
        return {"materials": []}
    if path.endswith("/recordings"):
        return {"recordings": []}
    return {}


def _patch_client(monkeypatch, get_fn):
    import mesa_api

    class FakeClient:
        def get(self, path, params=None):
            return get_fn(path, params)

    monkeypatch.setattr(mesa_api, "client_from_env", lambda: FakeClient())


def test_course_filter_preserves_global_rollups(home, monkeypatch):
    _patch_client(monkeypatch, _two_course_get)
    import lms_scrape
    summary = lms_scrape.run(["all", "--course", "course-a", "--json"])
    assert summary["courses"] == 1

    att = json.loads((home / "courses" / "_attendance.json").read_text())
    assert set(att["byCourse"]) == {"course-a", "course-b"}

    ann = json.loads((home / "courses" / "_announcements.json").read_text())
    assert any(a["id"] == "ann-1" for a in ann)

    # course-b was out of scope: its per-course raw content was not fetched
    assert not (home / "courses" / "course-b" / "raw" / "topics.json").exists()
    assert not (home / "courses" / "course-b" / "raw" / "materials.json").exists()


def test_failed_topics_preserves_existing_materials(home, monkeypatch):
    raw = home / "courses" / "course-a" / "raw"
    raw.mkdir(parents=True)
    (raw / "materials.json").write_text(json.dumps([{"id": "keep"}]))
    (raw / "recordings.json").write_text(json.dumps([{"id": "keep"}]))

    def get_fn(path, params=None):
        if path == "/curriculum/topics":
            raise RuntimeError("boom fetching topics")
        return _two_course_get(path, params)

    _patch_client(monkeypatch, get_fn)
    import lms_scrape
    summary = lms_scrape.run(["all", "--course", "course-a", "--json"])
    assert any("topics" in e for e in summary["errors"])
    assert json.loads((raw / "materials.json").read_text()) == [{"id": "keep"}]
    assert json.loads((raw / "recordings.json").read_text()) == [{"id": "keep"}]


def test_all_survives_course_step_failure(home, monkeypatch):
    def get_fn(path, params=None):
        if path == "/attendance/student/summary":
            raise RuntimeError("boom fetching summary")
        return _two_course_get(path, params)

    _patch_client(monkeypatch, get_fn)
    import lms_scrape
    summary = lms_scrape.run(["all", "--json"])
    assert isinstance(summary, dict)
    assert summary["errors"]
    assert summary["courses"] == 0


def test_cli_transcribe_reads_cached_index(home, monkeypatch):
    (home / "courses").mkdir(exist_ok=True)
    (home / "courses" / "_index.json").write_text(json.dumps(
        [{"id": "c1", "name": "Course One", "slug": "course-one"}]))
    (home / "courses" / "course-one" / "raw").mkdir(parents=True)
    (home / "courses" / "course-one" / "raw" / "recordings.json").write_text("[]")
    import transcribe, importlib, paths
    importlib.reload(paths); importlib.reload(transcribe)
    import lms_scrape
    result = lms_scrape.run(["transcribe", "--json"])
    assert result == {"transcribed": [], "skipped": [], "failed": []}


def test_cli_transcribe_url_dispatch(home, monkeypatch):
    import json, importlib, paths, transcribe
    (home / "courses").mkdir(parents=True, exist_ok=True)
    (home / "courses" / "_index.json").write_text(json.dumps(
        [{"id": "x", "name": "C", "slug": "c1"}]))
    importlib.reload(paths); importlib.reload(transcribe)
    monkeypatch.setattr(transcribe, "transcribe_url",
                        lambda *a, **k: {"ok": True, "path": "transcripts/url-x.md"})
    import lms_scrape
    r = lms_scrape.run(["transcribe-url", "--course", "c1",
                        "--url", "https://youtu.be/x", "--json"])
    assert r["ok"] is True


def test_cli_ingest_creates_inbox_and_normalizes(home):
    (home / "courses").mkdir(exist_ok=True)
    (home / "courses" / "_index.json").write_text(json.dumps(
        [{"id": "c1", "name": "Course One", "slug": "course-one"}]))
    raw = home / "courses" / "course-one" / "raw"
    raw.mkdir(parents=True)
    raw.joinpath("materials.json").write_text(json.dumps(
        [{"id": "m1", "kind": "text", "title": "N", "content": "<p>hi</p>", "localPath": None}]))
    raw.joinpath("assignments.json").write_text("[]")
    raw.joinpath("recordings.json").write_text("[]")
    raw.joinpath("topics.json").write_text("[]")
    import ingest, importlib, paths
    importlib.reload(paths); importlib.reload(ingest)
    import lms_scrape
    result = lms_scrape.run(["ingest", "--json"])
    assert result["perCourse"]["course-one"]["normalized"] >= 1
    assert (home / "courses" / "course-one" / "inbox" / "notes").is_dir()


def test_cli_all_with_stubbed_client(home, scrubbed, monkeypatch):
    import mesa_api

    class FakeClient:
        def get(self, path, params=None):
            return _scrubbed_get(scrubbed, path, params)

    monkeypatch.setattr(mesa_api, "client_from_env", lambda: FakeClient())
    import lms_scrape
    summary = lms_scrape.run(["all", "--json"])
    assert summary["term"] == "Term 1"
    assert summary["courses"] >= 12
    assert summary["errors"] == []
    assert (home / "courses" / "_index.json").exists()
    assert (home / "courses" / "business-frameworks" / "raw" / "topics.json").exists()
    assert "normalized" in summary
    assert "transcribed" not in summary
    assert summary["normalized"] >= 1
    assert "brainsIndexed" in summary and summary["brainsIndexed"] >= 0


def test_cli_all_survives_failing_topics(home, scrubbed, monkeypatch):
    import mesa_api

    class FakeClient:
        def get(self, path, params=None):
            if path == "/curriculum/topics":
                raise RuntimeError("boom fetching topics")
            return _scrubbed_get(scrubbed, path, params)

    monkeypatch.setattr(mesa_api, "client_from_env", lambda: FakeClient())
    import lms_scrape
    summary = lms_scrape.run(["all", "--json"])
    assert summary["courses"] >= 12
    assert summary["errors"]
    assert any("topics" in e for e in summary["errors"])
    assert (home / "courses" / "_index.json").exists()


def test_cli_all_isolates_one_bad_brain_index(home, scrubbed, monkeypatch):
    import mesa_api

    class FakeClient:
        def get(self, path, params=None):
            return _scrubbed_get(scrubbed, path, params)

    monkeypatch.setattr(mesa_api, "client_from_env", lambda: FakeClient())
    import brain
    real = brain.build_index
    bad = {"slug": None}

    def flaky(slug, force=False):
        if bad["slug"] is None:
            bad["slug"] = slug
        if slug == bad["slug"]:
            raise RuntimeError("corrupt corpus")
        return real(slug, force)

    monkeypatch.setattr(brain, "build_index", flaky)
    import lms_scrape
    summary = lms_scrape.run(["all", "--json"])
    assert any(f"brain-index {bad['slug']}" in e for e in summary["errors"])
    assert summary["brainsIndexed"] >= 1
    assert summary["brainsIndexed"] < summary["courses"]
    # another course still got a real index on disk
    others = [d.name for d in (home / "courses").iterdir()
              if (d / "brain" / "index.sqlite").exists()]
    assert others and bad["slug"] not in others


def test_cli_brain_query(home):
    import shutil
    from pathlib import Path
    FIX = Path(__file__).parent / "fixtures" / "scrubbed" / "brain_corpus"
    (home / "courses").mkdir(exist_ok=True)
    (home / "courses" / "_index.json").write_text(
        __import__("json").dumps([{"id": "c1", "name": "Course One", "slug": "course-one"}]))
    shutil.copytree(FIX / "course-one" / "normalized",
                    home / "courses" / "course-one" / "normalized")
    import importlib, paths, brain
    importlib.reload(paths); importlib.reload(brain)
    import lms_scrape
    payload = lms_scrape.run(["brain-query", "--params",
                              '{"course":"course-one","type":"assignment"}', "--json"])
    assert len(payload["results"]) == 1
    assert payload["results"][0]["type"] == "assignment"


def test_cli_calendar_sync_needs_auth(home, monkeypatch):
    (home / "courses").mkdir(exist_ok=True)
    import calendar_sync, importlib, paths
    importlib.reload(paths); importlib.reload(calendar_sync)
    monkeypatch.setattr(calendar_sync, "_service", lambda: None)
    import lms_scrape
    r = lms_scrape.run(["calendar-sync", "--json"])
    assert r["status"] == "needs-auth"


def test_cli_calendar_auth_no_secret(home, monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", str(home / "absent.json"))
    import importlib, paths, calendar_sync
    importlib.reload(paths); importlib.reload(calendar_sync)
    import lms_scrape
    r = lms_scrape.run(["calendar-auth"])
    assert r["status"] == "error"


def test_cli_brain_get(home):
    import shutil
    from pathlib import Path
    FIX = Path(__file__).parent / "fixtures" / "scrubbed" / "brain_corpus"
    (home / "courses").mkdir(exist_ok=True)
    (home / "courses" / "_index.json").write_text(
        __import__("json").dumps([{"id": "c1", "name": "Course One", "slug": "course-one"}]))
    shutil.copytree(FIX / "course-one" / "normalized",
                    home / "courses" / "course-one" / "normalized")
    import importlib, paths, brain
    importlib.reload(paths); importlib.reload(brain)
    import lms_scrape
    r = lms_scrape.run(["brain-get", "--course", "course-one",
                        "--path", "book-lean-startup.md", "--json"])
    assert r["frontmatter"]["type"] == "book" and "build-measure-learn" in r["body"]


def test_cli_brain_write_study(home, monkeypatch, capsys):
    import io, json as _j
    (home / "courses").mkdir(exist_ok=True)
    (home / "courses" / "_index.json").write_text(_j.dumps(
        [{"id": "c1", "name": "Course One", "slug": "course-one"}]))
    (home / "courses" / "course-one" / "normalized").mkdir(parents=True)
    monkeypatch.setattr("sys.stdin", io.StringIO("# Test Prep\nQ1. explain X\n"))
    import importlib, paths, brain
    importlib.reload(paths); importlib.reload(brain)
    import lms_scrape
    r = lms_scrape.run(["brain-write-study", "--course", "course-one",
                        "--name", "testprep-20260903", "--type", "testprep"])
    assert r["path"] == "study/testprep-20260903.md"
    written = (home / "courses" / "course-one" / "study" / "testprep-20260903.md").read_text()
    assert 'type: "testprep"' in written and 'course: "Course One"' in written and "Q1. explain X" in written


def test_main_exit_code_zero_on_clean_result(home, monkeypatch):
    import lms_scrape
    monkeypatch.setattr(lms_scrape, "run", lambda argv: {"errors": [], "courses": 3})
    assert lms_scrape.main_exit_code(["all", "--json"]) == 0


def test_main_exit_code_one_on_errors(home, monkeypatch):
    import lms_scrape
    monkeypatch.setattr(lms_scrape, "run", lambda argv: {"errors": ["boom"]})
    assert lms_scrape.main_exit_code(["all", "--json"]) == 1


def test_main_exit_code_one_on_ok_false(home, monkeypatch):
    import lms_scrape
    monkeypatch.setattr(lms_scrape, "run", lambda argv: {"ok": False})
    assert lms_scrape.main_exit_code(["x"]) == 1


def test_main_exit_code_one_on_failed_list(home, monkeypatch):
    import lms_scrape
    monkeypatch.setattr(lms_scrape, "run",
                        lambda argv: {"transcribed": [], "skipped": [], "failed": ["r1"]})
    assert lms_scrape.main_exit_code(["x"]) == 1


def test_main_exit_code_zero_when_run_returns_none(home, monkeypatch):
    import lms_scrape
    monkeypatch.setattr(lms_scrape, "run", lambda argv: None)
    assert lms_scrape.main_exit_code(["whoami"]) == 0


def test_cli_transcribe_inbox_without_index(home, monkeypatch):
    (home / "courses").mkdir(exist_ok=True)
    import transcribe, importlib, paths
    importlib.reload(paths); importlib.reload(transcribe)
    monkeypatch.setattr(
        transcribe, "step_transcribe",
        lambda index, course, inbox_only: {"transcribed": [], "skipped": [], "failed": []})
    import lms_scrape
    result = lms_scrape.run(["transcribe", "--inbox", "--json"])
    assert result == {"transcribed": [], "skipped": [], "failed": []}


def test_cli_daily_brief(home, monkeypatch):
    from pathlib import Path
    import shutil, importlib, paths, brain, daily_brief
    src = Path(__file__).parent / "fixtures" / "scrubbed" / "daily_corpus"
    shutil.rmtree(home / "courses", ignore_errors=True)
    shutil.copytree(src, home / "courses")
    importlib.reload(paths); importlib.reload(brain); importlib.reload(daily_brief)
    import lms_scrape
    r = lms_scrape.run(["daily-brief", "--json"])
    assert "classesToday" in r and "assignmentsDue" in r


def test_cli_overview(home):
    from pathlib import Path
    import shutil, importlib, paths, brain, daily_brief, overview
    src = Path(__file__).parent / "fixtures" / "scrubbed" / "overview_corpus"
    shutil.rmtree(home / "courses", ignore_errors=True)
    shutil.copytree(src, home / "courses")
    for m in (paths, brain, daily_brief, overview): importlib.reload(m)
    import lms_scrape
    r = lms_scrape.run(["overview", "--json"])
    assert "kpis" in r and "attendance" in r
