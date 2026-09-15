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


def test_access_token_none_without_token_file(monkeypatch, tmp_path):
    monkeypatch.setenv("GOOGLE_TOKEN", str(tmp_path / "missing.json"))
    assert ga.access_token() is None


def test_access_token_returns_valid_creds_token(monkeypatch):
    class FakeCreds:
        valid = True
        token = "abc123"

    monkeypatch.setattr(ga, "_valid_creds", lambda: FakeCreds())
    assert ga.access_token() == "abc123"


def test_service_and_access_token_use_the_same_validity_check(monkeypatch):
    """Both must go through _valid_creds — not drift into two different
    notions of 'is this token usable'."""
    calls = []

    def fake_valid_creds():
        calls.append(1)
        return None

    monkeypatch.setattr(ga, "_valid_creds", fake_valid_creds)
    assert ga.service("drive", "v3") is None
    assert ga.access_token() is None
    assert len(calls) == 2
