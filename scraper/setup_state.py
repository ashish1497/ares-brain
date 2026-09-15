"""Onboarding-gate checks: does this install have everything it needs
before the dashboard should open? No LLM, no LMS contact — reads the same
token.json google_auth.py owns, plus .env (via mesa_api's own token read),
off disk."""
import json

import google_auth
import mesa_api

_PLACEHOLDERS = {"", "changeme", "your_token_here"}


def _token_scopes() -> set[str]:
    if not google_auth.token_path().exists():
        return set()
    try:
        data = json.loads(google_auth.token_path().read_text())
    except (OSError, json.JSONDecodeError):
        return set()
    return set(data.get("scopes") or [])


def _mesa_token_present() -> bool:
    val = mesa_api._current_refresh_token()
    return bool(val) and val.lower() not in _PLACEHOLDERS


def check_setup() -> dict:
    scopes = _token_scopes()
    return {
        "driveConnected": "https://www.googleapis.com/auth/drive.file" in scopes,
        "calendarConnected": "https://www.googleapis.com/auth/calendar" in scopes,
        "mesaTokenPresent": _mesa_token_present(),
    }
