import json

import pytest

import scrape_steps
import mesa_api


class _SummaryClient:
    def __init__(self, rows):
        self.rows = rows

    def get(self, path, params=None):
        assert path == "/sum"
        return self.rows


_CFG = {"endpoints": {"attendanceSummary": "/sum"}, "termIdOverride": None}


def test_discover_term_env_override(monkeypatch):
    monkeypatch.setenv("MESA_TERM_ID", "t-env")
    client = _SummaryClient([{"termId": "t-env", "termName": "Env Term"}])
    assert scrape_steps.discover_term(client, _CFG) == {
        "termId": "t-env", "termName": "Env Term"}


def test_discover_term_config_override(monkeypatch):
    monkeypatch.delenv("MESA_TERM_ID", raising=False)
    cfg = {"endpoints": {"attendanceSummary": "/sum"}, "termIdOverride": "t-cfg"}
    assert scrape_steps.discover_term(_SummaryClient([]), cfg) == {
        "termId": "t-cfg", "termName": ""}


def test_discover_term_empty_summary_raises(monkeypatch):
    monkeypatch.delenv("MESA_TERM_ID", raising=False)
    with pytest.raises(mesa_api.ApiError):
        scrape_steps.discover_term(_SummaryClient([]), _CFG)


def test_discover_term_row_missing_termid_raises(monkeypatch):
    monkeypatch.delenv("MESA_TERM_ID", raising=False)
    with pytest.raises(mesa_api.ApiError):
        scrape_steps.discover_term(_SummaryClient([{"termName": "T"}]), _CFG)


class FakeClient:
    def __init__(self, scrubbed):
        self.s = scrubbed

    def get(self, path, params=None):
        if path == "/users/me":
            return {"user": {"id": "stu-1"}}
        if path == "/attendance/student/summary":
            return self.s("attendance_summary.json")["data"]
        if path == "/curriculum/courses":
            return self.s("courses_term1.json")["data"]
        raise AssertionError(path)


def test_step_courses_writes_index_and_meta(home, scrubbed):
    client = FakeClient(scrubbed)
    cfg = mesa_api.load_config()
    index = scrape_steps.step_courses(client, cfg)

    idx = json.loads((home / "courses" / "_index.json").read_text())
    meta = json.loads((home / "courses" / "_meta.json").read_text())

    assert idx == index
    assert meta["termName"] == "Term 1"
    assert meta["termId"] == "17a4f404-0fde-4db8-9599-3a20d3199416"
    assert meta["studentId"] == "stu-1"
    assert meta["scrapedAt"].endswith("Z")

    # union of /curriculum/courses (6 scrubbed) + attendance-only courses (6)
    assert len(idx) == 12
    # sorted by name.lower()
    assert [c["name"] for c in idx] == sorted((c["name"] for c in idx), key=str.lower)

    bf = next(c for c in idx if c["name"].startswith("Business Frameworks"))
    assert bf["name"] == "Business Frameworks"
    assert bf["slug"] == "business-frameworks"
    assert set(bf) == {"id", "name", "slug", "instructorName", "courseType", "classType"}

    # attendance-only course present, with null metadata
    aos = next(c for c in idx if c["name"] == "The Art of Selling")
    assert aos["instructorName"] is None
    assert aos["courseType"] is None
