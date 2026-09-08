import json
from pathlib import Path
import pytest
import transcribe

FIX = Path(__file__).parent / "fixtures" / "scrubbed"


def test_fmt_ts():
    assert transcribe._fmt_ts(0) == "00:00:00"
    assert transcribe._fmt_ts(187.4) == "00:03:07"
    assert transcribe._fmt_ts(3661) == "01:01:01"


@pytest.mark.slow
def test_whisper_on_sample_wav():
    segs = transcribe._whisper(FIX / "sample.wav")
    assert isinstance(segs, list)  # a 440Hz tone yields few/no segments; just no crash


def test_step_transcribe_youtube_failure_is_recorded(home, monkeypatch):
    course = {"id": "c1", "name": "Course One", "slug": "course-one"}
    (home / "courses" / "course-one" / "raw").mkdir(parents=True)
    (home / "courses" / "course-one" / "raw" / "recordings.json").write_text(json.dumps(
        [{"id": "rec1", "title": "Session 1", "videoUrl": "https://youtube.com/live/x",
          "provider": "youtube", "recordedOn": "2026-08-20"}]))
    import importlib, paths
    importlib.reload(paths); importlib.reload(transcribe)
    monkeypatch.setattr(transcribe, "_pull_audio", lambda url, d: None)   # simulate yt-dlp failure
    result = transcribe.step_transcribe([course])

    assert result["failed"] == ["rec1"] or "rec1" in [f["id"] for f in result["failed"]]
    failed = json.loads((home / "courses" / "course-one" / "transcripts" / "_failed.json").read_text())
    assert any(f["id"] == "rec1" and f["status"] == "needs-manual" for f in failed)
    assert not (home / "courses" / "course-one" / "transcripts" / "rec1.md").exists()


def test_step_transcribe_whisper_failure_is_recorded(home, monkeypatch):
    course = {"id": "c1", "name": "Course One", "slug": "course-one"}
    (home / "courses" / "course-one" / "raw").mkdir(parents=True)
    (home / "courses" / "course-one" / "raw" / "recordings.json").write_text(json.dumps(
        [{"id": "rec1", "title": "Session 1", "videoUrl": "https://youtube.com/live/x",
          "provider": "youtube", "recordedOn": "2026-08-20"}]))

    import importlib, paths
    importlib.reload(paths); importlib.reload(transcribe)
    monkeypatch.setattr(transcribe, "_pull_audio", lambda url, d: FIX / "sample.wav")

    def boom(audio):
        raise RuntimeError("ctranslate2 boom")
    monkeypatch.setattr(transcribe, "_whisper", boom)

    result = transcribe.step_transcribe([course])

    assert "rec1" in [f["id"] for f in result["failed"]]
    failed = json.loads((home / "courses" / "course-one" / "transcripts" / "_failed.json").read_text())
    assert any(f["id"] == "rec1" and f["status"] == "needs-manual" for f in failed)
    assert not (home / "courses" / "course-one" / "transcripts" / "rec1.md").exists()


def test_step_transcribe_skips_existing(home, monkeypatch):
    course = {"id": "c1", "name": "Course One", "slug": "course-one"}
    tdir = home / "courses" / "course-one" / "transcripts"
    tdir.mkdir(parents=True)
    (tdir / "rec1.md").write_text("---\ntype: transcript\n---\ncached")
    (home / "courses" / "course-one" / "raw").mkdir(parents=True)
    (home / "courses" / "course-one" / "raw" / "recordings.json").write_text(json.dumps(
        [{"id": "rec1", "title": "Session 1", "videoUrl": "u", "provider": "youtube"}]))

    def boom(*a, **k):
        raise AssertionError("should not transcribe a cached recording")
    monkeypatch.setattr(transcribe, "_pull_audio", boom)
    import importlib, paths
    importlib.reload(paths); importlib.reload(transcribe)
    monkeypatch.setattr(transcribe, "_pull_audio", boom)
    result = transcribe.step_transcribe([course])
    assert "rec1" in result["skipped"]


# --- A-ingest final review fixes ---

import yaml


def test_write_transcript_frontmatter_is_valid_yaml(home):
    dest = home / "courses" / "course-one" / "transcripts" / "t.md"
    transcribe._write_transcript(
        dest,
        {"id": "r1", "title": 'Session 1: "Intro" — #1', "recordedOn": "2026-08-20"},
        {"name": "Course #1: Frameworks"},
        [(0.0, "hello")])
    text = dest.read_text()
    fm = text.split("---\n", 2)[1]
    loaded = yaml.safe_load(fm)
    assert loaded["title"] == 'Session 1: "Intro" — #1'
    assert loaded["course"] == "Course #1: Frameworks"


def test_step_transcribe_malformed_recording_entry_is_recorded(home, monkeypatch):
    course = {"id": "c1", "name": "Course One", "slug": "course-one"}
    (home / "courses" / "course-one" / "raw").mkdir(parents=True)
    (home / "courses" / "course-one" / "raw" / "recordings.json").write_text(json.dumps(
        [{"title": "no id"}, "a bare string", {"id": "ok", "videoUrl": "u"}]))
    import importlib, paths
    importlib.reload(paths); importlib.reload(transcribe)
    monkeypatch.setattr(transcribe, "_pull_audio", lambda url, d: None)
    result = transcribe.step_transcribe([course])
    ids = [f["id"] for f in result["failed"]]
    assert "?" in ids            # malformed entries
    assert "ok" in ids           # valid-but-no-audio
    assert result["transcribed"] == []
