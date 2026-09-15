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
