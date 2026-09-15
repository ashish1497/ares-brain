"""Onboarding-gate checks: does this install have everything it needs
before the dashboard should open? No LLM, no LMS contact for the mesa-token
check (reads .env via mesa_api's own token read, off disk) — but
driveConnected/calendarConnected do a real, network-touching liveness probe
against Google (google_auth.service(...)), the same way probeClaudeCli does
a real check on the TS side rather than trusting a static file read. A
revoked/expired token that still lists the right scopes must not open the
gate, since google_auth.service() would then silently return None for every
Drive/Calendar call downstream."""
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
    has_drive_scope = "https://www.googleapis.com/auth/drive.file" in scopes
    has_calendar_scope = "https://www.googleapis.com/auth/calendar" in scopes
    # Scope presence alone doesn't mean the token still works — probe for real,
    # matching how claudeCliLoggedIn does a live check rather than a static read.
    drive_connected = has_drive_scope and google_auth.service("drive", "v3") is not None
    calendar_connected = has_calendar_scope and google_auth.service("calendar", "v3") is not None
    return {
        "driveConnected": drive_connected,
        "calendarConnected": calendar_connected,
        "mesaTokenPresent": _mesa_token_present(),
    }
