import json
import scrape_steps
import mesa_api


class FakeClient:
    def __init__(self, scrubbed): self.s = scrubbed
    def get(self, path, params=None):
        assert path == "/content/topics/rec-topic/recordings"
        return self.s("topic_recordings_real.json")["data"]


def test_recordings_manifest(home, scrubbed):
    course = {"id": "bf", "name": "BF", "slug": "bf"}
    topics = [{"id": "rec-topic", "type": "recordings"}]
    cfg = mesa_api.load_config()
    r = scrape_steps.step_recordings(FakeClient(scrubbed), cfg, course, topics)
    rec = json.loads((home / "courses" / "bf" / "raw" / "recordings.json").read_text())
    assert r["recordings"] == len(rec) >= 1
    assert rec[0]["provider"] == "youtube"
    assert rec[0]["videoUrl"].startswith("https://www.youtube.com/")


def test_recordings_no_topic(home, scrubbed):
    course = {"id": "x", "name": "X", "slug": "x"}
    cfg = mesa_api.load_config()
    r = scrape_steps.step_recordings(FakeClient(scrubbed), cfg, course, [])
    assert r["recordings"] == 0
    assert json.loads((home / "courses" / "x" / "raw" / "recordings.json").read_text()) == []
