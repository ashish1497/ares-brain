import json
from unittest.mock import patch


def test_drive_guide_check_not_found(home):
    with patch("drive_sync.read_or_none", return_value=None):
        import lms_scrape
        result = lms_scrape.run(["drive-guide-check", "--course", "ai-101", "--json"])
    assert result == {"found": False}


def test_drive_guide_check_found(home):
    with patch("drive_sync.read_or_none", return_value=b"# Guide\ncontent"):
        import lms_scrape
        result = lms_scrape.run(["drive-guide-check", "--course", "ai-101", "--json"])
    assert result["found"] is True
    assert "content" in result["body"]


def test_drive_guide_upload_missing_local_guide(home):
    import lms_scrape
    result = lms_scrape.run(["drive-guide-upload", "--course", "ai-101", "--json"])
    assert result == {"ok": False, "error": "GUIDE.md not found locally"}


def test_drive_guide_upload_shares_local_guide(home):
    guide_dir = home / "courses" / "ai-101" / "brain"
    guide_dir.mkdir(parents=True)
    (guide_dir / "GUIDE.md").write_text("# Guide\ncontent")

    with patch("drive_sync.write_if_absent", return_value=True) as mock_write:
        import lms_scrape
        result = lms_scrape.run(["drive-guide-upload", "--course", "ai-101", "--json"])

    assert result == {"ok": True, "wrote": True}
    assert mock_write.called
    args = mock_write.call_args.args
    assert args[0] == "ai-101"
    assert args[1] == "guide/GUIDE.md"
    assert args[2] == b"# Guide\ncontent"


def test_share_note_missing_local_file(home):
    import lms_scrape
    result = lms_scrape.run(["share-note", "--course", "ai-101",
                              "--path", "normalized/self-note-x.md", "--json"])
    assert result == {"ok": False, "error": "normalized/self-note-x.md not found"}


def test_share_note_uploads_and_returns_link(home, monkeypatch):
    note_dir = home / "courses" / "ai-101" / "normalized"
    note_dir.mkdir(parents=True)
    (note_dir / "self-note-x.md").write_text("# My note")
    monkeypatch.setenv("ARES_BRAIN_STUDENT_NAME", "Ashish")

    with patch("drive_sync.upload_shared", return_value="https://drive.google.com/x") as mock_up:
        import lms_scrape
        result = lms_scrape.run(["share-note", "--course", "ai-101",
                                  "--path", "normalized/self-note-x.md", "--json"])

    assert result == {"ok": True, "link": "https://drive.google.com/x"}
    assert mock_up.called
    args = mock_up.call_args.args
    assert args[0] == "ai-101"
    assert args[1].startswith("notes/")
    assert args[1] == "notes/Ashish/self-note-x.md"


def test_share_study_missing_file(home):
    import lms_scrape
    result = lms_scrape.run(["share-study", "--course", "ai-101",
                              "--name", "does-not-exist", "--json"])
    assert result["ok"] is False


def test_share_study_uploads_and_returns_link(home, monkeypatch):
    study_dir = home / "courses" / "ai-101" / "study"
    study_dir.mkdir(parents=True)
    (study_dir / "testprep-20260912.md").write_text("# Study artifact")
    monkeypatch.setenv("ARES_BRAIN_STUDENT_NAME", "Ashish")

    with patch("drive_sync.upload_shared", return_value="https://drive.google.com/y") as mock_up:
        import lms_scrape
        result = lms_scrape.run(["share-study", "--course", "ai-101",
                                  "--name", "testprep-20260912", "--json"])

    assert result == {"ok": True, "link": "https://drive.google.com/y"}
    assert mock_up.called
    args = mock_up.call_args.args
    assert args[0] == "ai-101"
    assert args[1].startswith("testprep/")
    assert args[1] == "testprep/Ashish/testprep-20260912.md"
