# Auth Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One combined Google OAuth (Calendar + Drive) behind a shared
`google_auth.py`, plus `drive_sync.py` primitives (`read_or_none`,
`write_if_absent`, `upload_shared`) that everything downstream (sync, gate,
notes, testprep) depends on.

**Architecture:** Extract the OAuth plumbing already living inside
`calendar_sync.py` into a new `scraper/google_auth.py` with a combined scope
list; `calendar_sync.py` calls into it instead of owning `_SCOPES`/`_service`
itself. A new `scraper/drive_sync.py` uses the same credentials to read/write
files in the shared per-course Drive folder, keyed by
`config/course-drive-folders.json`.

**Tech Stack:** Python (`scraper/`), `google-auth-oauthlib`,
`google-api-python-client` (already dependencies via `calendar_sync.py`).

**Spec:** `docs/superpowers/specs/2026-09-12-collaborative-multi-student-design.md`
(sections C.1, D). This plan implements Build-order item 1.

## Global Constraints

- Combined OAuth scopes: `https://www.googleapis.com/auth/calendar` +
  `https://www.googleapis.com/auth/drive.file` — exact strings, no broader
  Drive scope.
- `token.json`/`client_secret.json` paths and env-var overrides
  (`GOOGLE_TOKEN`, `GOOGLE_CLIENT_SECRET`) are UNCHANGED from
  `calendar_sync.py` today — `google_auth.py` takes over those exact
  functions, `calendar_sync.py` must keep working with existing tokens on
  disk (no re-auth forced on existing users).
- `calendar-auth` CLI subcommand and `calendar_sync.do_auth` stay
  call-compatible — this plan must not break any of the 5 D/D-oauth/D-sessions
  sub-projects already shipped (see `courses/../ares-brain-project.md`
  history — this repo has zero tolerance for breaking calendar sync).
- Attendance/assignments code paths never call `drive_sync` — this plan does
  not touch `scrape_steps.py`'s attendance/assignment handling at all.
- Every new module keeps the repo's import-isolation discipline: `brain.py`
  must not import `mesa_api`/`scrape_steps`; `drive_sync.py` must not import
  `mesa_api` either (it's LMS-independent).

---

### Task 1: `google_auth.py` — shared OAuth module

**Files:**

- Create: `scraper/google_auth.py`
- Test: `scraper/tests/test_google_auth.py`

**Interfaces:**

- Produces: `SCOPES: list[str]`, `client_secret_path() -> Path`,
  `token_path() -> Path`, `service(api_name: str, version: str) -> object |
None`, `do_auth() -> dict` (same return shape
  `calendar_sync.do_auth()` currently has: `{"status": "ok"|"error",
"hint"?: str}`).

- [ ] **Step 1: Write the failing tests**

```python
# scraper/tests/test_google_auth.py
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd scraper && uv run pytest tests/test_google_auth.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'google_auth'`

- [ ] **Step 3: Write `google_auth.py`**

Port `calendar_sync.py`'s `_client_secret_path`/`_token_path`/
`_creds_from_token_file`/`_installed_app_flow`/`_service`/`do_auth`
(lines 83–150ish) here verbatim except: rename to the public names above,
change `_SCOPES` to the combined `SCOPES` list, and make `service()` take
`(api_name, version)` instead of hardcoding `"calendar", "v3"`:

```python
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
    flow = _installed_app_flow(str(cs))
    creds = flow.run_local_server(port=0)
    token_path().write_text(creds.to_json())
    os.chmod(token_path(), 0o600)
    return {"status": "ok"}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd scraper && uv run pytest tests/test_google_auth.py -v`
Expected: PASS (5/5)

- [ ] **Step 5: Commit**

```bash
git add scraper/google_auth.py scraper/tests/test_google_auth.py
git commit -m "feat: add shared google_auth module for calendar+drive"
```

---

### Task 2: Refactor `calendar_sync.py` onto `google_auth`

**Files:**

- Modify: `scraper/calendar_sync.py:1-150` (auth section)
- Test: `scraper/tests/test_calendar_sync.py` (existing — must still pass unmodified)

**Interfaces:**

- Consumes: `google_auth.service("calendar", "v3")`, `google_auth.do_auth()`
- Produces: `calendar_sync._service()` (thin wrapper, same return contract:
  a Calendar API service object or `None`), `calendar_sync.do_auth` (re-export)

- [ ] **Step 1: Run the existing calendar_sync test suite to establish a baseline**

Run: `cd scraper && uv run pytest tests/test_calendar_sync.py -v`
Expected: all currently passing (record the count, e.g. "38 passed")

- [ ] **Step 2: Replace the auth section**

Delete `_SCOPES`, `_client_secret_path`, `_token_path`,
`_creds_from_token_file`, `_build_service`, `_installed_app_flow`,
`_service`, `do_auth` from `calendar_sync.py`. Replace with:

```python
import google_auth


def _service():
    return google_auth.service("calendar", "v3")


do_auth = google_auth.do_auth
```

Keep `AUTH_HINT` as-is (still calendar_sync-specific messaging used elsewhere
in the file).

- [ ] **Step 3: Run the full calendar_sync suite again**

Run: `cd scraper && uv run pytest tests/test_calendar_sync.py -v`
Expected: PASS, same count as Step 1 baseline — zero regressions

- [ ] **Step 4: Run import-isolation check**

Run: `cd scraper && uv run python -c "import calendar_sync, sys; bad = {'mesa_api','scrape_steps'} & set(sys.modules); import sys as s; s.exit(1 if bad else 0)"`
Expected: exit 0

- [ ] **Step 5: Commit**

```bash
git add scraper/calendar_sync.py
git commit -m "refactor: calendar_sync uses shared google_auth module"
```

---

### Task 3: `config/course-drive-folders.json`

**Files:**

- Create: `config/course-drive-folders.json`
- Test: `scraper/tests/test_drive_sync.py` (folder-lookup portion)

**Interfaces:**

- Produces: a checked-in JSON file, shape `{ "<course-slug>": "<drive-folder-id>" }`

- [ ] **Step 1: Write the failing test for the lookup helper**

(This step's test lives with Task 4's `drive_sync.py` tests — see Task 4
Step 1's `test_folder_id_for_course_reads_config`.)

- [ ] **Step 2: Create the config file with a placeholder empty object**

```json
{}
```

This file starts empty — folder IDs get added by whoever runs Drive setup
for each course (a manual, documented step, not code). Real IDs are out of
scope for this plan; the lookup mechanism is what's being built.

- [ ] **Step 3: Commit**

```bash
git add config/course-drive-folders.json
git commit -m "chore: add course-drive-folders config (empty, populated per-course later)"
```

---

### Task 4: `drive_sync.py` — read/write-if-absent/upload primitives

**Files:**

- Create: `scraper/drive_sync.py`
- Test: `scraper/tests/test_drive_sync.py`

**Interfaces:**

- Consumes: `google_auth.service("drive", "v3")`,
  `config/course-drive-folders.json` (via `paths.HOME / "config" /
"course-drive-folders.json"` — note: `config/` lives at repo root
  alongside `courses/`, not under `HOME/courses/`, so this reads
  `paths.HOME.parent / "config"` when `ARES_BRAIN_HOME` differs from the
  repo root, OR simply `Path(__file__).resolve().parent.parent /
"config"` since config is a repo-checked-in file, not per-install data.
  **Decision for this task: use the latter** — config ships with the repo,
  it is not user data, so it is NOT relocated by `ARES_BRAIN_HOME`.
- Produces:
  - `folder_id_for_course(slug: str) -> str | None`
  - `read_or_none(slug: str, subpath: str) -> bytes | None`
  - `write_if_absent(slug: str, subpath: str, content: bytes, content_hash: str) -> bool` (returns whether it wrote — False means "already present, skipped")
  - `upload_shared(slug: str, subpath: str, local_path: Path) -> str | None` (returns the shareable link, or None on failure)

- [ ] **Step 1: Write the failing tests**

```python
# scraper/tests/test_drive_sync.py
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd scraper && uv run pytest tests/test_drive_sync.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'drive_sync'`

- [ ] **Step 3: Write `drive_sync.py`**

```python
"""Shared-Drive read/write primitives for the collaborative data layer
(materials, transcripts, GUIDE.md, opt-in notes/testprep). Never touches
attendance or assignments — those code paths don't call this module.
No LLM, no LMS contact."""
import json
from pathlib import Path

import google_auth

_FOLDER_NAME_TO_SUBDIR = {
    "materials": "materials",
    "transcripts": "transcripts",
    "guide": "guide",
}


def _config_dir() -> Path:
    return Path(__file__).resolve().parent.parent / "config"


def _folders_config() -> dict:
    p = _config_dir() / "course-drive-folders.json"
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text())
    except (OSError, json.JSONDecodeError):
        return {}


def folder_id_for_course(slug: str) -> str | None:
    return _folders_config().get(slug)


def _drive_service():
    return google_auth.service("drive", "v3")


def _find(svc, folder_id: str, name: str) -> dict | None:
    q = f"'{folder_id}' in parents and name = '{name}' and trashed = false"
    resp = svc.files().list(q=q, fields="files(id, appProperties)").execute()
    files = resp.get("files") or []
    return files[0] if files else None


def read_or_none(slug: str, subpath: str) -> bytes | None:
    folder_id = folder_id_for_course(slug)
    if not folder_id:
        return None
    svc = _drive_service()
    if svc is None:
        return None
    name = subpath.replace("/", "__")
    hit = _find(svc, folder_id, name)
    if not hit:
        return None
    return svc.files().get_media(fileId=hit["id"]).execute()


def write_if_absent(slug: str, subpath: str, content: bytes, content_hash: str) -> bool:
    folder_id = folder_id_for_course(slug)
    if not folder_id:
        return False
    svc = _drive_service()
    if svc is None:
        return False
    name = subpath.replace("/", "__")
    existing = _find(svc, folder_id, name)
    if existing and existing.get("appProperties", {}).get("contentHash") == content_hash:
        return False
    from googleapiclient.http import MediaInMemoryUpload
    media = MediaInMemoryUpload(content, mimetype="application/octet-stream")
    metadata = {"name": name, "parents": [folder_id], "appProperties": {"contentHash": content_hash}}
    svc.files().create(body=metadata, media_body=media, fields="id").execute()
    return True


def upload_shared(slug: str, subpath: str, local_path: Path) -> str | None:
    folder_id = folder_id_for_course(slug)
    if not folder_id:
        return None
    svc = _drive_service()
    if svc is None:
        return None
    from googleapiclient.http import MediaFileUpload
    name = subpath.replace("/", "__")
    media = MediaFileUpload(str(local_path))
    metadata = {"name": name, "parents": [folder_id]}
    created = svc.files().create(body=metadata, media_body=media, fields="id, webViewLink").execute()
    return created.get("webViewLink")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd scraper && uv run pytest tests/test_drive_sync.py -v`
Expected: PASS (5/5)

- [ ] **Step 5: Import-isolation guard**

Run: `cd scraper && uv run python -c "import drive_sync, sys; bad = {'mesa_api','scrape_steps'} & set(sys.modules); sys.exit(1 if bad else 0)"`
Expected: exit 0

- [ ] **Step 6: Commit**

```bash
git add scraper/drive_sync.py scraper/tests/test_drive_sync.py
git commit -m "feat: add drive_sync read/write-if-absent/upload primitives"
```

---

## Self-Review Notes (for the plan author, not a task)

- Task 4's `_find` uses a Drive `files.list` query by exact name within the
  folder — subpath `/` is flattened to `__` to keep filenames flat inside
  each Drive subfolder rather than building real nested Drive folders per
  subpath segment; this is a deliberate simplification the plan for Task 3
  (Shared-first sync) must follow consistently.
- `write_if_absent`'s content-hash comparison assumes the hash algorithm
  matches whatever `ingest.py`'s `_body_hash`/`_file_hash` produces (sha256
  hex digest) — the Shared-first-sync plan (item 3) must pass the same hash
  it already computes, not a new one.
