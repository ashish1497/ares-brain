"""Shared Google OAuth for Calendar + Drive. One consent, one token.json.
No LLM, no LMS contact."""
import json
import os
import sys
from pathlib import Path

from paths import HOME

SCOPES = [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/drive.file",
]


def client_secret_path() -> Path:
    return Path(os.environ.get("GOOGLE_CLIENT_SECRET") or (HOME / "client_secret.json"))


def token_path() -> Path:
    return Path(os.environ.get("GOOGLE_TOKEN") or (HOME / "token.json"))


def _creds_from_token_file():
    from google.oauth2.credentials import Credentials
    return Credentials.from_authorized_user_file(str(token_path()), SCOPES)


def _build_service(api_name: str, version: str, creds):
    from googleapiclient.discovery import build
    return build(api_name, version, credentials=creds, cache_discovery=False)


def _installed_app_flow(cs_path: str):
    from google_auth_oauthlib.flow import InstalledAppFlow
    return InstalledAppFlow.from_client_secrets_file(cs_path, SCOPES)


def service(api_name: str, version: str):
    if not token_path().exists():
        return None
    try:
        creds = _creds_from_token_file()
    except Exception:  # noqa: BLE001
        return None
    if getattr(creds, "valid", False):
        pass
    elif getattr(creds, "expired", False) and getattr(creds, "refresh_token", None):
        try:
            from google.auth.transport.requests import Request
            creds.refresh(Request())
            token_path().write_text(creds.to_json())
            os.chmod(token_path(), 0o600)
        except Exception:  # noqa: BLE001
            return None
    else:
        return None
    try:
        return _build_service(api_name, version, creds)
    except Exception as exc:  # noqa: BLE001
        print(f"google service init failed ({api_name}): {exc}", file=sys.stderr)
        return None


def do_auth() -> dict:
    cs = client_secret_path()
    if not cs.exists():
        return {"status": "error",
                "hint": f"no client_secret.json at {cs} — download a Desktop OAuth client from GCP Console"}
    try:
        conf = json.loads(cs.read_text())
    except Exception as exc:  # noqa: BLE001
        return {"status": "error", "hint": f"client_secret.json is not valid JSON: {exc}"}
    if not isinstance(conf, dict) or "installed" not in conf:
        kind = next(iter(conf), "unknown") if isinstance(conf, dict) else "unknown"
        return {"status": "error",
                "hint": f"client_secret.json must be a Desktop OAuth client (got '{kind}')"}
    try:
        flow = _installed_app_flow(str(cs))
        creds = flow.run_local_server(port=0)
        token_path().write_text(creds.to_json())
        os.chmod(token_path(), 0o600)
    except Exception as exc:  # noqa: BLE001
        return {"status": "error", "hint": str(exc)}
    return {"status": "ok"}
