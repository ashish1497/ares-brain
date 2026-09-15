import json
from pathlib import Path
import pytest
import google_auth as ga


def test_scopes_include_calendar_and_drive_file():
    assert "https://www.googleapis.com/auth/calendar" in ga.SCOPES
    assert "https://www.googleapis.com/auth/drive.file" in ga.SCOPES


def test_client_secret_path_env_override(monkeypatch, tmp_path):
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", str(tmp_path / "cs.json"))
    assert ga.client_secret_path() == tmp_path / "cs.json"


def test_token_path_env_override(monkeypatch, tmp_path):
    monkeypatch.setenv("GOOGLE_TOKEN", str(tmp_path / "tok.json"))
    assert ga.token_path() == tmp_path / "tok.json"


def test_service_returns_none_without_token(monkeypatch, tmp_path):
    monkeypatch.setenv("GOOGLE_TOKEN", str(tmp_path / "missing.json"))
    assert ga.service("calendar", "v3") is None


def test_do_auth_missing_client_secret(monkeypatch, tmp_path):
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", str(tmp_path / "nope.json"))
    result = ga.do_auth()
    assert result["status"] == "error"
    assert "client_secret.json" in result["hint"]
