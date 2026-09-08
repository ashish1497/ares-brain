import json
import scrape_steps
import mesa_api


class FakeClient:
    def __init__(self, scrubbed): self.s = scrubbed; self.calls = 0
    def get(self, path, params=None):
        self.calls += 1
        assert path == "/curriculum/topics"
        assert params == {"courseId": "bf"}
        return self.s("topics.json")["data"]


def test_step_topics_writes_raw(home, scrubbed):
    course = {"id": "bf", "name": "Business Frameworks", "slug": "business-frameworks"}
    cfg = mesa_api.load_config()
    topics = scrape_steps.step_topics(FakeClient(scrubbed), cfg, course)
    written = json.loads((home / "courses" / "business-frameworks" / "raw" / "topics.json").read_text())
    assert {t["type"] for t in written} == {
        "outline", "prereads", "assignments", "resources", "recordings", "announcements"}
    assert scrape_steps.topics_by_type(topics)["recordings"]["title"] == "Class Recordings"


def test_step_topics_idempotent(home, scrubbed):
    course = {"id": "bf", "name": "Business Frameworks", "slug": "business-frameworks"}
    cfg = mesa_api.load_config()
    client = FakeClient(scrubbed)
    dest = home / "courses" / "business-frameworks" / "raw" / "topics.json"

    first = scrape_steps.step_topics(client, cfg, course)
    assert client.calls == 1
    assert dest.exists()

    second = scrape_steps.step_topics(client, cfg, course, force=False)
    assert client.calls == 1
    assert second == first

    dest.write_text("[]")
    third = scrape_steps.step_topics(client, cfg, course, force=True)
    assert client.calls == 2
    assert third == first
    assert json.loads(dest.read_text()) == first
