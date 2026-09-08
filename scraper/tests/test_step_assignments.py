import json

import scrape_steps
import mesa_api

KEEP = {"id", "title", "courseId", "courseName", "topicId", "instructions",
        "submissionType", "isGroup", "dueAt", "cutoffDate", "allowLate",
        "status", "mySubmissionStatus", "materials", "createdAt"}


class FakeClient:
    def __init__(self, scrubbed):
        self.s = scrubbed

    def get(self, path, params=None):
        if path == "/assignments/my":
            return self.s("assignments_my.json")["data"]
        if path == "/assignments":
            # only the Business Frameworks course id returns a fixture
            if params.get("courseId") == "41e90532-d355-4d05-903d-df8dff2ccaa7":
                return self.s("assignments_course.json")["data"]
            return {"assignments": []}
        raise AssertionError(path)


def test_merge_dedupes_and_buckets(home, scrubbed):
    (home / "courses" / "business-frameworks" / "raw").mkdir(parents=True)
    (home / "courses" / "business-frameworks" / "raw" / "topics.json").write_text("[]")
    index = [{"id": "41e90532-d355-4d05-903d-df8dff2ccaa7",
              "name": "Business Frameworks with Pranjal Bangani",
              "slug": "business-frameworks"}]
    cfg = mesa_api.load_config()
    result = scrape_steps.step_assignments(FakeClient(scrubbed), cfg, index)

    bf = json.loads((home / "courses" / "business-frameworks" / "raw" / "assignments.json").read_text())
    ids = [a["id"] for a in bf]
    assert len(ids) == len(set(ids))                      # deduped
    assert all(set(a) == KEEP for a in bf)                # only kept fields
    unassigned = json.loads((home / "courses" / "_assignments-unassigned.json").read_text())
    assert result["unassigned"] == len(unassigned)
    assert result["unassigned"] >= 1                      # my-work has courseId=null items


class DictClient:
    def __init__(self, mine, by_course):
        self._mine = mine
        self._by_course = by_course

    def get(self, path, params=None):
        if path == "/assignments/my":
            return {"assignments": self._mine}
        if path == "/assignments":
            return {"assignments": self._by_course.get(params.get("courseId"), [])}
        raise AssertionError(path)


def test_dedupe_prefers_non_null_courseId(home):
    (home / "courses" / "course-c" / "raw").mkdir(parents=True)
    (home / "courses" / "course-c" / "raw" / "topics.json").write_text("[]")
    client = DictClient(
        mine=[{"id": "X", "courseId": None, "topicId": None, "title": "my"}],
        by_course={"C": [{"id": "X", "courseId": "C", "courseTitle": "Course C", "title": "course"}]},
    )
    index = [{"id": "C", "name": "Course C", "slug": "course-c"}]
    scrape_steps.step_assignments(client, mesa_api.load_config(), index)

    cc = json.loads((home / "courses" / "course-c" / "raw" / "assignments.json").read_text())
    assert len(cc) == 1
    assert cc[0]["courseId"] == "C"
    assert cc[0]["courseName"] == "Course C"
    unassigned = json.loads((home / "courses" / "_assignments-unassigned.json").read_text())
    assert unassigned == []


def test_resolves_null_courseId_via_topic(home):
    (home / "courses" / "course-c" / "raw").mkdir(parents=True)
    (home / "courses" / "course-c" / "raw" / "topics.json").write_text(
        json.dumps([{"id": "T1", "courseId": "C", "title": "Assignments", "type": "assignments"}]))
    client = DictClient(
        mine=[{"id": "Y", "courseId": None, "topicId": "T1", "title": "y"}],
        by_course={},
    )
    index = [{"id": "C", "name": "Course C", "slug": "course-c"}]
    scrape_steps.step_assignments(client, mesa_api.load_config(), index)

    cc = json.loads((home / "courses" / "course-c" / "raw" / "assignments.json").read_text())
    assert [a["id"] for a in cc] == ["Y"]
    unassigned = json.loads((home / "courses" / "_assignments-unassigned.json").read_text())
    assert unassigned == []
