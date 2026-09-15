import json
from unittest.mock import MagicMock, patch
import drive_sync as ds


def test_folder_id_for_course_reads_config(tmp_path, monkeypatch):
    cfg = tmp_path / "config"
    cfg.mkdir()
    (cfg / "course-drive-folders.json").write_text(json.dumps({"ai-101": "FOLDER123"}))
    monkeypatch.setattr(ds, "_config_dir", lambda: cfg)
    assert ds.folder_id_for_course("ai-101") == "FOLDER123"
    assert ds.folder_id_for_course("unknown-course") is None


def test_register_folder_writes_and_merges(tmp_path, monkeypatch):
    cfg = tmp_path / "config"
    cfg.mkdir()
    (cfg / "course-drive-folders.json").write_text(json.dumps({"existing-course": "F0"}))
    monkeypatch.setattr(ds, "_config_dir", lambda: cfg)

    result = ds.register_folder("ai-101", "FOLDER123")

    assert result == {"existing-course": "F0", "ai-101": "FOLDER123"}
    on_disk = json.loads((cfg / "course-drive-folders.json").read_text())
    assert on_disk == {"existing-course": "F0", "ai-101": "FOLDER123"}


def test_register_folder_overwrites_existing_entry(tmp_path, monkeypatch):
    cfg = tmp_path / "config"
    cfg.mkdir()
    (cfg / "course-drive-folders.json").write_text(json.dumps({"ai-101": "OLD"}))
    monkeypatch.setattr(ds, "_config_dir", lambda: cfg)

    result = ds.register_folder("ai-101", "NEW")

    assert result["ai-101"] == "NEW"
    assert ds.folder_id_for_course("ai-101") == "NEW"


def test_read_or_none_returns_none_when_no_folder_configured(monkeypatch):
    monkeypatch.setattr(ds, "folder_id_for_course", lambda slug: None)
    assert ds.read_or_none("no-folder-course", "materials/x.md") is None


def test_read_or_none_returns_none_when_file_not_found(monkeypatch):
    monkeypatch.setattr(ds, "folder_id_for_course", lambda slug: "FOLDER123")
    mock_svc = MagicMock()
    mock_svc.files().list().execute.return_value = {"files": []}
    monkeypatch.setattr(ds, "_drive_service", lambda: mock_svc)
    assert ds.read_or_none("ai-101", "materials/x.md") is None


def test_write_if_absent_skips_when_hash_matches(monkeypatch):
    monkeypatch.setattr(ds, "folder_id_for_course", lambda slug: "FOLDER123")
    mock_svc = MagicMock()
    mock_svc.files().list().execute.return_value = {
        "files": [{"id": "F1", "appProperties": {"contentHash": "abc123"}}]
    }
    monkeypatch.setattr(ds, "_drive_service", lambda: mock_svc)
    wrote = ds.write_if_absent("ai-101", "materials/x.md", b"data", "abc123")
    assert wrote is False


def test_write_if_absent_uploads_when_missing(monkeypatch):
    monkeypatch.setattr(ds, "folder_id_for_course", lambda slug: "FOLDER123")
    mock_svc = MagicMock()
    mock_svc.files().list().execute.return_value = {"files": []}
    monkeypatch.setattr(ds, "_drive_service", lambda: mock_svc)
    wrote = ds.write_if_absent("ai-101", "materials/x.md", b"data", "newhash")
    assert wrote is True
    mock_svc.files().create.assert_called()


def test_write_if_absent_updates_when_hash_differs(monkeypatch):
    """C2: an existing same-named file with a DIFFERENT hash must be updated
    in place, not create()-d again as a duplicate (Drive allows duplicate
    names, so create() here silently produces duplicate files over time)."""
    monkeypatch.setattr(ds, "folder_id_for_course", lambda slug: "FOLDER123")
    mock_svc = MagicMock()
    mock_svc.files().list().execute.return_value = {
        "files": [{"id": "F1", "appProperties": {"contentHash": "oldhash"}}]
    }
    monkeypatch.setattr(ds, "_drive_service", lambda: mock_svc)
    wrote = ds.write_if_absent("ai-101", "guide/GUIDE.md", b"new content", "newhash")
    assert wrote is True
    mock_svc.files().update.assert_called_once()
    assert mock_svc.files().update.call_args.kwargs["fileId"] == "F1"
    assert not mock_svc.files().create.called


def test_list_shared_excludes_named_subfolder(monkeypatch):
    monkeypatch.setattr(ds, "folder_id_for_course", lambda slug: "FOLDER123")
    mock_svc = MagicMock()
    mock_svc.files().list().execute.return_value = {
        "files": [
            {"id": "F1", "name": "notes__priya__n1.md"},
            {"id": "F2", "name": "notes__arjun__n2.md"},
        ]
    }
    mock_svc.files().get_media().execute.return_value = b"arjun's note"
    monkeypatch.setattr(ds, "_drive_service", lambda: mock_svc)
    results = ds.list_shared("ai-101", "notes", exclude_subfolder="priya")
    assert len(results) == 1
    assert results[0]["subfolder"] == "arjun"
    assert results[0]["content"] == b"arjun's note"


def test_browse_not_connected_when_no_folder_configured(monkeypatch):
    monkeypatch.setattr(ds, "folder_id_for_course", lambda slug: None)
    result = ds.browse("no-folder-course")
    assert result["connected"] is False
    assert result["materials"] == []
    assert result["notes"] == []


def test_browse_reports_drive_error_when_service_unavailable(monkeypatch):
    monkeypatch.setattr(ds, "folder_id_for_course", lambda slug: "FOLDER123")
    monkeypatch.setattr(ds, "_drive_service", lambda: None)
    result = ds.browse("ai-101")
    assert result["connected"] is True
    assert "error" in result


def test_browse_parses_flat_and_subfoldered_names_separately(monkeypatch):
    """materials/transcripts/guide are flat `<prefix>__<name>` (2 segments);
    notes/testprep are `<prefix>__<subfolder>__<name>` (3+ segments) — browse
    must route each shape correctly, not require exactly 3 segments like
    list_shared's internal parser does."""
    monkeypatch.setattr(ds, "folder_id_for_course", lambda slug: "FOLDER123")
    mock_svc = MagicMock()
    mock_svc.files().list().execute.return_value = {
        "files": [
            {"id": "M1", "name": "materials__material-syllabus.md", "webViewLink": "https://drive/m1"},
            {"id": "T1", "name": "transcripts__rec42.md", "webViewLink": "https://drive/t1"},
            {"id": "G1", "name": "guide__GUIDE.md", "webViewLink": "https://drive/g1"},
            {"id": "N1", "name": "notes__priya__n1.md", "webViewLink": "https://drive/n1"},
            {"id": "S1", "name": "testprep__arjun__testprep-1.md", "webViewLink": "https://drive/s1"},
        ]
    }
    monkeypatch.setattr(ds, "_drive_service", lambda: mock_svc)
    result = ds.browse("ai-101")
    assert result["connected"] is True
    assert [m["name"] for m in result["materials"]] == ["material-syllabus.md"]
    assert [t["name"] for t in result["transcripts"]] == ["rec42.md"]
    assert result["guide"]["name"] == "GUIDE.md"
    assert result["notes"] == [
        {"subfolder": "priya", "name": "n1.md", "link": "https://drive/n1", "modifiedTime": None}
    ]
    assert result["testprep"][0]["subfolder"] == "arjun"
