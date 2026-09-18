import json
import subprocess
import sys
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


def test_pull_audio_invokes_yt_dlp_module(monkeypatch, tmp_path):
    recorded = {}

    def fake_run(args, *a, **k):
        recorded["cmd"] = args
        return subprocess.CompletedProcess(args, 0, b"", b"")

    monkeypatch.setattr(transcribe.subprocess, "run", fake_run)
    transcribe._pull_audio("https://x/v", tmp_path)
    cmd = recorded["cmd"]
    assert cmd[:3] == [sys.executable, "-m", "yt_dlp"]
    assert cmd[-1] == "https://x/v"


def test_pull_audio_logs_and_returns_none_on_failure(monkeypatch, tmp_path, capsys):
    def fake_run(args, *a, **k):
        raise subprocess.CalledProcessError(1, "yt-dlp", stderr=b"ERROR: boom")

    monkeypatch.setattr(transcribe.subprocess, "run", fake_run)
    result = transcribe._pull_audio("https://x/v", tmp_path)
    assert result is None
    err = capsys.readouterr().err
    assert "boom" in err or "yt-dlp failed" in err


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


def test_step_transcribe_uses_shared_transcript_when_present(home, monkeypatch):
    course = {"id": "c1", "name": "Course One", "slug": "course-one"}
    (home / "courses" / "course-one" / "raw").mkdir(parents=True)
    (home / "courses" / "course-one" / "raw" / "recordings.json").write_text(json.dumps(
        [{"id": "rec1", "title": "Session 1", "videoUrl": "https://youtube.com/live/x",
          "provider": "youtube", "recordedOn": "2026-08-20"}]))
    import importlib, paths
    importlib.reload(paths); importlib.reload(transcribe)

    shared_content = b"---\ntype: transcript\n---\n[00:00:00] shared content\n"
    calls = {}

    def fake_read_or_none(slug, subpath):
        calls["args"] = (slug, subpath)
        return shared_content

    def boom(*a, **k):
        raise AssertionError("should not pull audio when a shared transcript exists")

    monkeypatch.setattr(transcribe.drive_sync, "read_or_none", fake_read_or_none)
    monkeypatch.setattr(transcribe, "_pull_audio", boom)

    result = transcribe.step_transcribe([course])

    assert calls["args"] == ("course-one", "transcripts/rec1.md")
    assert "rec1" in result["transcribed"]
    dest = home / "courses" / "course-one" / "transcripts" / "rec1.md"
    assert dest.read_bytes() == shared_content


def test_step_transcribe_shares_after_local_transcription(home, monkeypatch):
    course = {"id": "c1", "name": "Course One", "slug": "course-one"}
    (home / "courses" / "course-one" / "raw").mkdir(parents=True)
    (home / "courses" / "course-one" / "raw" / "recordings.json").write_text(json.dumps(
        [{"id": "rec1", "title": "Session 1", "videoUrl": "https://youtube.com/live/x",
          "provider": "youtube", "recordedOn": "2026-08-20"}]))
    import importlib, paths
    importlib.reload(paths); importlib.reload(transcribe)

    write_calls = []

    def fake_write_if_absent(slug, subpath, content, content_hash):
        write_calls.append((slug, subpath, content, content_hash))
        return True

    monkeypatch.setattr(transcribe.drive_sync, "read_or_none", lambda slug, subpath: None)
    monkeypatch.setattr(transcribe.drive_sync, "write_if_absent", fake_write_if_absent)
    monkeypatch.setattr(transcribe, "_pull_audio", lambda url, d: FIX / "sample.wav")
    monkeypatch.setattr(transcribe, "_whisper", lambda audio: [(0.0, "hello")])

    result = transcribe.step_transcribe([course])

    assert "rec1" in result["transcribed"]
    assert len(write_calls) == 1
    slug, subpath, content, content_hash = write_calls[0]
    assert slug == "course-one"
    assert subpath == "transcripts/rec1.md"
    dest = home / "courses" / "course-one" / "transcripts" / "rec1.md"
    assert content == dest.read_bytes()
    assert content_hash == transcribe.ingest._body_hash(content.decode())


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
