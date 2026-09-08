import json
from datetime import datetime, timezone
import scrape_steps
import mesa_api


class FakeClient:
    def __init__(self, scrubbed): self.s = scrubbed
    def get(self, path, params=None):
        if path == "/attendance/student/summary":
            return self.s("attendance_summary.json")["data"]
        if path == "/events/my":
            return self.s("events_my.json")["data"]
        if path == "/announcements":
            page = (params or {}).get("page", 1)
            return self.s("announcements.json")["data"] if page == 1 else {"announcements": []}
        raise AssertionError(path)


def _index(home):
    return json.loads((home / "courses" / "_index.json").read_text())


def test_attendance_uses_total_as_sessions_conducted(home, scrubbed):
    (home / "courses" / "_index.json").write_text(json.dumps([
        {"id": "ac9a4adc-af63-43b3-824d-51a7280e77d6",
         "name": "AI and its Application", "slug": "ai-and-its-application"}]))
    cfg = mesa_api.load_config()
    scrape_steps.step_attendance(FakeClient(scrubbed), cfg, _index(home))
    att = json.loads((home / "courses" / "_attendance.json").read_text())
    ai = att["byCourse"]["ai-and-its-application"]
    assert ai["sessionsConducted"] == 4 and ai["attended"] == 3


def test_events_written_with_window(home, scrubbed):
    (home / "courses" / "_index.json").write_text("[]")
    cfg = mesa_api.load_config()
    scrape_steps.step_events(FakeClient(scrubbed), cfg, [])
    ev = json.loads((home / "courses" / "_events.json").read_text())
    assert "from" in ev["window"] and ev["window"]["from"].endswith(".000Z")
    assert len(ev["events"]) >= 1


def test_announcements_split(home, scrubbed):
    (home / "courses" / "_index.json").write_text("[]")
    cfg = mesa_api.load_config()
    r = scrape_steps.step_announcements(FakeClient(scrubbed), cfg, [])
    prog = json.loads((home / "courses" / "_announcements.json").read_text())
    assert r["program"] == len(prog) and r["program"] >= 1
