import json
from pathlib import Path
import pytest
import transcribe


@pytest.fixture
def course(home, monkeypatch):
    root = home / "courses" / "ai-course"
    (root / "inbox" / "recordings").mkdir(parents=True)
    (root / "raw").mkdir(parents=True)
    (root / "raw" / "recordings.json").write_text(json.dumps(
        [{"id": "yt1", "title": "Class 1", "videoUrl": "https://youtu.be/yt1"}]))
    (home / "courses" / "_index.json").write_text(json.dumps(
        [{"id": "x", "name": "AI Course", "slug": "ai-course"}]))
    (root / "inbox" / "recordings" / "myclip.m4a").write_bytes(b"fake")
    import importlib, paths
    importlib.reload(paths); importlib.reload(transcribe)
    return home


def test_inbox_only_skips_youtube(course, monkeypatch):
    calls = []
    monkeypatch.setattr(transcribe, "_pull_audio",
                        lambda url, d: calls.append(url) or None)
    monkeypatch.setattr(transcribe, "_whisper", lambda a: [(0.0, "hi")])
    idx = json.loads((course / "courses" / "_index.json").read_text())
    r = transcribe.step_transcribe(idx, "ai-course", inbox_only=True)
    assert calls == []                       # never touched the YouTube rec
    assert "inbox-myclip" in r["transcribed"]
    assert (course / "courses" / "ai-course" / "transcripts" / "inbox-myclip.md").exists()
