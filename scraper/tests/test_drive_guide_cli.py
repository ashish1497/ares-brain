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
