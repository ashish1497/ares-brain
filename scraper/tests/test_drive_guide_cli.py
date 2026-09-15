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
    (note_dir / "self-note-x.md").write_text(
        '---\ntype: self-note\ntitle: "My note"\n---\n# My note\n')
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


def test_share_note_rejects_path_traversal(home, monkeypatch):
    """C1: --path must not escape courses/<slug>/normalized/ — e.g. reaching
    the .env holding the Mesa refresh token."""
    (home / ".env").write_text("MESA_REFRESH_TOKEN=secret\n")
    (home / "courses" / "ai-101" / "normalized").mkdir(parents=True)
    monkeypatch.setenv("ARES_BRAIN_STUDENT_NAME", "Ashish")

    with patch("drive_sync.upload_shared") as mock_up:
        import lms_scrape
        result = lms_scrape.run(["share-note", "--course", "ai-101",
                                  "--path", "../../.env", "--json"])

    assert result["ok"] is False
    assert not mock_up.called


def test_share_note_rejects_non_self_note_type(home, monkeypatch):
    """C1: only frontmatter type: self-note may be shared — not assignments,
    attendance, or any other course material."""
    note_dir = home / "courses" / "ai-101" / "normalized"
    note_dir.mkdir(parents=True)
    (note_dir / "assignment-1.md").write_text(
        '---\ntype: assignment\ntitle: "Assignment 1"\n---\nsecret grading rubric\n')
    monkeypatch.setenv("ARES_BRAIN_STUDENT_NAME", "Ashish")

    with patch("drive_sync.upload_shared") as mock_up:
        import lms_scrape
        result = lms_scrape.run(["share-note", "--course", "ai-101",
                                  "--path", "normalized/assignment-1.md", "--json"])

    assert result["ok"] is False
    assert not mock_up.called


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


def test_share_study_rejects_name_with_traversal(home, monkeypatch):
    """C1: --name is attacker-controlled and must not be able to reach
    outside study_dir(slug) via a '..'-containing name."""
    monkeypatch.setenv("ARES_BRAIN_STUDENT_NAME", "Ashish")
    with patch("drive_sync.upload_shared") as mock_up:
        import lms_scrape
        result = lms_scrape.run(["share-study", "--course", "ai-101",
                                  "--name", "../../.env", "--json"])
    assert result["ok"] is False
    assert not mock_up.called


def test_share_study_rejects_name_with_slash(home, monkeypatch):
    monkeypatch.setenv("ARES_BRAIN_STUDENT_NAME", "Ashish")
    with patch("drive_sync.upload_shared") as mock_up:
        import lms_scrape
        result = lms_scrape.run(["share-study", "--course", "ai-101",
                                  "--name", "sub/dir", "--json"])
    assert result["ok"] is False
    assert not mock_up.called


def test_drive_access_token_returns_token(home):
    with patch("google_auth.access_token", return_value="tok123"):
        import lms_scrape
        result = lms_scrape.run(["drive-access-token", "--json"])
    assert result == {"token": "tok123"}


def test_drive_access_token_none_when_not_connected(home):
    with patch("google_auth.access_token", return_value=None):
        import lms_scrape
        result = lms_scrape.run(["drive-access-token", "--json"])
    assert result == {"token": None}


def test_drive_browse_rejects_bad_course(home):
    import lms_scrape
    result = lms_scrape.run(["drive-browse", "--course", "..", "--json"])
    assert result["connected"] is False
    assert "invalid course" in result["error"]


def test_drive_browse_delegates_to_drive_sync(home):
    fake = {"connected": True, "materials": [{"name": "x.md"}], "transcripts": [],
            "guide": None, "notes": [], "testprep": []}
    with patch("drive_sync.browse", return_value=fake) as mock_browse:
        import lms_scrape
        result = lms_scrape.run(["drive-browse", "--course", "ai-101", "--json"])
    assert result == fake
    mock_browse.assert_called_once_with("ai-101")


def test_drive_register_folder_rejects_bad_course(home):
    import lms_scrape
    result = lms_scrape.run(["drive-register-folder", "--course", "..",
                             "--folder-id", "F1", "--json"])
    assert result == {"ok": False, "error": "invalid course: '..'"}


def test_drive_register_folder_rejects_empty_id(home):
    import lms_scrape
    result = lms_scrape.run(["drive-register-folder", "--course", "ai-101",
                             "--folder-id", "  ", "--json"])
    assert result == {"ok": False, "error": "folder id required"}


def test_drive_register_folder_writes_config(home):
    with patch("drive_sync.register_folder", return_value={"ai-101": "F1"}) as mock_reg:
        import lms_scrape
        result = lms_scrape.run(["drive-register-folder", "--course", "ai-101",
                                 "--folder-id", "F1", "--json"])
    assert result == {"ok": True, "folders": {"ai-101": "F1"}}
    mock_reg.assert_called_once_with("ai-101", "F1")


def test_list_study_returns_items(home):
    with patch("brain.list_study", return_value=[{"name": "testprep-1", "type": "testprep"}]):
        import lms_scrape
        result = lms_scrape.run(["list-study", "--course", "ai-101", "--json"])
    assert result == {"items": [{"name": "testprep-1", "type": "testprep"}]}
