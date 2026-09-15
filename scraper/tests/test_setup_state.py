import json
from unittest.mock import MagicMock

import setup_state as ss


def test_all_false_with_no_token_and_no_env(home, monkeypatch):
    monkeypatch.setenv("GOOGLE_TOKEN", str(home / "missing.json"))
    monkeypatch.delenv("MESA_REFRESH_TOKEN", raising=False)
    result = ss.check_setup()
    assert result == {
        "driveConnected": False,
        "calendarConnected": False,
        "mesaTokenPresent": False,
    }


def test_calendar_and_drive_true_when_token_has_both_scopes_and_service_live(home, monkeypatch):
    token_file = home / "token.json"
    token_file.write_text(json.dumps({
        "token": "x", "refresh_token": "y", "client_id": "z", "client_secret": "w",
        "scopes": [
            "https://www.googleapis.com/auth/calendar",
            "https://www.googleapis.com/auth/drive.file",
        ],
    }))
    monkeypatch.setenv("GOOGLE_TOKEN", str(token_file))
    monkeypatch.setattr(ss.google_auth, "service", lambda api, version: MagicMock())
    result = ss.check_setup()
    assert result["driveConnected"] is True
    assert result["calendarConnected"] is True


def test_drive_false_when_only_calendar_scope_present(home, monkeypatch):
    token_file = home / "token.json"
    token_file.write_text(json.dumps({
        "token": "x", "refresh_token": "y", "client_id": "z", "client_secret": "w",
        "scopes": ["https://www.googleapis.com/auth/calendar"],
    }))
    monkeypatch.setenv("GOOGLE_TOKEN", str(token_file))
    monkeypatch.setattr(ss.google_auth, "service", lambda api, version: MagicMock())
    result = ss.check_setup()
    assert result["driveConnected"] is False
    assert result["calendarConnected"] is True


def test_drive_and_calendar_false_when_scopes_present_but_service_dead(home, monkeypatch):
    """I5: a revoked/expired token that still lists the right scopes must not
    open the gate — google_auth.service() returning None (as it does for a
    bad token) must flip both flags false even though the scope strings are
    present."""
    token_file = home / "token.json"
    token_file.write_text(json.dumps({
        "token": "x", "refresh_token": "y", "client_id": "z", "client_secret": "w",
        "scopes": [
            "https://www.googleapis.com/auth/calendar",
            "https://www.googleapis.com/auth/drive.file",
        ],
    }))
    monkeypatch.setenv("GOOGLE_TOKEN", str(token_file))
    monkeypatch.setattr(ss.google_auth, "service", lambda api, version: None)
    result = ss.check_setup()
    assert result["driveConnected"] is False
    assert result["calendarConnected"] is False


def test_mesa_token_present_from_env_file(home, monkeypatch):
    env_file = home / ".env"
    env_file.write_text("MESA_REFRESH_TOKEN=abc123\n")
    monkeypatch.delenv("MESA_REFRESH_TOKEN", raising=False)
    monkeypatch.setenv("GOOGLE_TOKEN", str(home / "missing.json"))
    result = ss.check_setup()
    assert result["mesaTokenPresent"] is True


def test_mesa_token_absent_when_placeholder(home, monkeypatch):
    env_file = home / ".env"
    env_file.write_text("MESA_REFRESH_TOKEN=changeme\n")
    monkeypatch.delenv("MESA_REFRESH_TOKEN", raising=False)
    monkeypatch.setenv("GOOGLE_TOKEN", str(home / "missing.json"))
    result = ss.check_setup()
    assert result["mesaTokenPresent"] is False
