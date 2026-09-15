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
