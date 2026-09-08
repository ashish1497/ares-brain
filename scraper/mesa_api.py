"""Mesa LMS HTTP client: token refresh (with rotation), unwrapped GETs.

See docs/lms-api.md for the endpoint reference and the token-rotation rule.
"""
import base64
import contextlib
import fcntl
import json
import os
import re
import time
from pathlib import Path

import requests
from dotenv import load_dotenv

import paths
from paths import HOME

# HOME here is import-time only, used purely to seed os.environ from .env for
# convenience. Every runtime read path resolves paths.HOME live (see
# _current_refresh_token / persist_refresh_token) so the test home fixture that
# reloads `paths` still works.
load_dotenv(HOME / ".env")

REQUEST_TIMEOUT = 45
POLITE_DELAY = 0.3

_REPO_CONFIG = Path(__file__).resolve().parent.parent / "config" / "mesa-api.json"


class AuthError(RuntimeError):
    pass


class ApiError(RuntimeError):
    pass


def load_config() -> dict:
    local = paths.HOME / "config" / "mesa-api.json"
    return json.loads((local if local.exists() else _REPO_CONFIG).read_text())


def jwt_expiry(token: str):
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        return json.loads(base64.urlsafe_b64decode(payload)).get("exp")
    except Exception:
        return None


def _current_refresh_token() -> str:
    env = paths.HOME / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("MESA_REFRESH_TOKEN="):
                return line.split("=", 1)[1].strip()
    return (os.environ.get("MESA_REFRESH_TOKEN") or "").strip()


def persist_refresh_token(value: str) -> None:
    env = paths.HOME / ".env"
    lines = env.read_text().splitlines() if env.exists() else []
    out, replaced = [], False
    for line in lines:
        if line.startswith("MESA_REFRESH_TOKEN="):
            out.append(f"MESA_REFRESH_TOKEN={value}")
            replaced = True
        else:
            out.append(line)
    if not replaced:
        out.append(f"MESA_REFRESH_TOKEN={value}")
    tmp = env.parent / (env.name + ".tmp")
    with open(tmp, "w") as f:
        f.write("\n".join(out) + "\n")
        f.flush()
        os.fsync(f.fileno())
    os.chmod(tmp, 0o600)
    os.replace(tmp, env)


@contextlib.contextmanager
def _token_lock():
    """Serialize the read-current -> POST -> persist sequence so a launchd run
    and a manual run don't spend each other's single-use refresh token."""
    lock_path = paths.HOME / ".token.lock"
    lock_path.touch(exist_ok=True)
    with open(lock_path, "w") as fh:
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(fh.fileno(), fcntl.LOCK_UN)


def _rotated_token(resp) -> str | None:
    token = resp.cookies.get("refresh_token")
    if token:
        return token
    raw = resp.headers.get("Set-Cookie", "")
    for m in re.finditer(r"refresh_token=([^;]+)", raw):
        if m.group(1):
            return m.group(1)
    return None


def refresh() -> str:
    with _token_lock():
        return _refresh_locked()


def _refresh_locked() -> str:
    cfg = load_config()
    current = _current_refresh_token()
    if not current:
        raise AuthError(
            "No MESA_REFRESH_TOKEN in .env. Paste a fresh refresh_token cookie "
            "from the LMS (DevTools > Application > Cookies)."
        )
    try:
        resp = requests.post(
            cfg["authRefresh"],
            headers={"Content-Type": "application/json",
                     "Origin": cfg["frontendBase"],
                     "Referer": f"{cfg['frontendBase']}/student/lms"},
            cookies={"refresh_token": current},
            data="{}",
            timeout=REQUEST_TIMEOUT,
        )
    except requests.RequestException as exc:
        raise AuthError(f"refresh request failed: {exc.__class__.__name__}")

    body = {}
    try:
        body = resp.json()
    except ValueError:
        pass
    access = (body.get("data") or {}).get("accessToken")
    if not access:
        msg = (body.get("error") or {}).get("message", f"HTTP {resp.status_code}")
        raise AuthError(
            f"refresh rejected ({msg}). The refresh token rotates on every use; "
            "the stored one is spent. Paste a fresh refresh_token cookie into .env."
        )
    rotated = _rotated_token(resp)
    if rotated and rotated != current:
        persist_refresh_token(rotated)
        os.environ["MESA_REFRESH_TOKEN"] = rotated
        print("  rotated refresh token saved to .env")
    return access


class MesaClient:
    def __init__(self, access_token: str, cfg: dict):
        self.cfg = cfg
        self.base = cfg["baseUrl"]
        self._session = requests.Session()
        self._set_token(access_token)

    def _set_token(self, token: str):
        self._session.headers.update({
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "Origin": self.cfg["frontendBase"],
            "Referer": f"{self.cfg['frontendBase']}/student/lms",
        })

    def get(self, path: str, params: dict | None = None, _retried: bool = False):
        url = path if path.startswith("http") else f"{self.base}{path}"
        time.sleep(POLITE_DELAY)
        try:
            resp = self._session.get(url, params=params, timeout=REQUEST_TIMEOUT)
        except requests.RequestException as exc:
            raise ApiError(f"{path}: {exc.__class__.__name__}")
        if resp.status_code == 401 and not _retried:
            self._set_token(refresh())
            return self.get(path, params, _retried=True)
        if resp.status_code == 401:
            raise AuthError(f"{path}: 401 after refresh — token unusable.")
        if not resp.ok:
            raise ApiError(f"{path}: HTTP {resp.status_code}")
        try:
            return resp.json().get("data")
        except (ValueError, AttributeError):
            raise ApiError(f"{path}: response was not the expected JSON envelope")


def client_from_env() -> MesaClient:
    cfg = load_config()
    token = (os.environ.get("MESA_ACCESS_TOKEN") or "").strip()
    exp = jwt_expiry(token) if token else None
    if not token or exp is None or exp - time.time() < 60:
        token = refresh()
    return MesaClient(token, cfg)
