import json
from pathlib import Path
import pytest
import transcribe


@pytest.fixture
def idx(home):
    (home / "courses").mkdir(parents=True, exist_ok=True)
    (home / "courses" / "_index.json").write_text(
        json.dumps([{"id": "x", "name": "AI Course", "slug": "ai-course"}]))
    import importlib, paths
    importlib.reload(paths); importlib.reload(transcribe)
    return home


def test_transcribe_url_writes_transcript(idx, monkeypatch):
    monkeypatch.setattr(transcribe, "_pull_audio",
                        lambda url, d: Path(d) / "fake.m4a")
    monkeypatch.setattr(transcribe, "_whisper",
                        lambda a: [(0.0, "hello"), (5.0, "world")])
    r = transcribe.transcribe_url("ai-course", "https://youtu.be/abc", title="Lecture 1")
    assert r["ok"] is True
    p = idx / "courses" / "ai-course" / "transcripts" / r["path"].split("/")[-1]
    body = p.read_text()
    assert "type: transcript" in body
    assert '"Lecture 1"' in body
    assert "url:https://youtu.be/abc" in body or "url:https" in body
    assert "[00:00:00] hello" in body and "[00:00:05] world" in body


def test_transcribe_url_bad_course(idx):
    r = transcribe.transcribe_url("no-such", "https://youtu.be/abc")
    assert r["ok"] is False and "course" in r["error"].lower()


def test_transcribe_url_audio_pull_fails(idx, monkeypatch):
    monkeypatch.setattr(transcribe, "_pull_audio", lambda url, d: None)
    r = transcribe.transcribe_url("ai-course", "https://youtu.be/x")
    assert r["ok"] is False and "audio" in r["error"].lower()


def test_transcribe_url_whisper_raises(idx, monkeypatch):
    monkeypatch.setattr(transcribe, "_pull_audio", lambda url, d: Path(d) / "f.m4a")
    def boom(a): raise RuntimeError("model exploded")
    monkeypatch.setattr(transcribe, "_whisper", boom)
    r = transcribe.transcribe_url("ai-course", "https://youtu.be/x")
    assert r["ok"] is False  # never raises
