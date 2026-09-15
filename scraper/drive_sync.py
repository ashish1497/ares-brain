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


def register_folder(slug: str, folder_id: str) -> dict:
    """Add/replace one course's Drive folder ID in the checked-in config.
    This only writes the LOCAL copy of config/course-drive-folders.json —
    propagating a newly registered folder to the rest of the cohort still
    means committing and pushing it, the same as any other repo config
    (no new distribution mechanism, per the spec's own non-goals)."""
    p = _config_dir() / "course-drive-folders.json"
    current = _folders_config()
    current[slug] = folder_id
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(current, indent=2, sort_keys=True) + "\n")
    return current


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
    if existing:
        # Same name already exists with a different hash — update it in place
        # instead of create()-ing a duplicate (Drive allows duplicate names).
        svc.files().update(
            fileId=existing["id"],
            body={"appProperties": {"contentHash": content_hash}},
            media_body=media,
        ).execute()
        return True
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


def _list_shared_meta(svc, folder_id: str, prefix: str,
                      exclude_subfolder: str | None = None) -> list[dict]:
    """Metadata-only listing (no content download) of shared files matching
    `prefix__<subfolder>__<name>`. Used both by list_shared (which then
    downloads content) and by callers that just need a cheap signature."""
    q = f"'{folder_id}' in parents and trashed = false"
    resp = svc.files().list(q=q, fields="files(id, name)").execute()
    out = []
    for f in resp.get("files") or []:
        parts = f["name"].split("__", 2)
        if len(parts) != 3 or parts[0] != prefix:
            continue
        subfolder, name = parts[1], parts[2]
        if exclude_subfolder and subfolder == exclude_subfolder:
            continue
        out.append({"id": f["id"], "subfolder": subfolder, "name": name})
    return out


def list_shared_meta(slug: str, prefix: str, exclude_subfolder: str | None = None) -> list[dict]:
    """Like list_shared but without downloading file content — cheap enough
    to call just to detect whether the shared set changed."""
    folder_id = folder_id_for_course(slug)
    if not folder_id:
        return []
    svc = _drive_service()
    if svc is None:
        return []
    metas = _list_shared_meta(svc, folder_id, prefix, exclude_subfolder)
    return [{"subfolder": m["subfolder"], "name": m["name"]} for m in metas]


def browse(slug: str) -> dict:
    """Everything shared for a course, for a dashboard listing — NOT the
    same shape as list_shared (which downloads content for one prefix at a
    time and only handles the notes/testprep <prefix>__<subfolder>__<name>
    shape). materials/transcripts/guide are flat <prefix>__<name> files
    with no subfolder segment, so they need their own parse here."""
    out = {
        "connected": False,
        "materials": [],
        "transcripts": [],
        "guide": None,
        "notes": [],
        "testprep": [],
    }
    folder_id = folder_id_for_course(slug)
    if not folder_id:
        return out
    out["connected"] = True
    svc = _drive_service()
    if svc is None:
        out["error"] = "Drive not authorized"
        return out
    q = f"'{folder_id}' in parents and trashed = false"
    try:
        resp = svc.files().list(q=q, fields="files(id, name, modifiedTime, webViewLink)").execute()
    except Exception as exc:  # noqa: BLE001 — a live Drive API error (bad folder
        # ID, API not enabled on the GCP project, revoked access, etc.) must
        # degrade to a clean {connected, error} the UI can show, matching every
        # other drive_sync function's never-raise contract — not an uncaught
        # exception that crashes the whole CLI subprocess.
        out["error"] = str(exc)
        return out
    for f in resp.get("files") or []:
        parts = f["name"].split("__")
        if len(parts) < 2:
            continue
        prefix = parts[0]
        row = {
            "name": "__".join(parts[1:]),
            "link": f.get("webViewLink"),
            "modifiedTime": f.get("modifiedTime"),
        }
        if prefix == "materials":
            out["materials"].append(row)
        elif prefix == "transcripts":
            out["transcripts"].append(row)
        elif prefix == "guide":
            out["guide"] = row
        elif prefix in ("notes", "testprep") and len(parts) >= 3:
            out[prefix].append({
                "subfolder": parts[1],
                "name": "__".join(parts[2:]),
                "link": f.get("webViewLink"),
                "modifiedTime": f.get("modifiedTime"),
            })
    return out


def list_shared(slug: str, prefix: str, exclude_subfolder: str | None = None) -> list[dict]:
    folder_id = folder_id_for_course(slug)
    if not folder_id:
        return []
    svc = _drive_service()
    if svc is None:
        return []
    metas = _list_shared_meta(svc, folder_id, prefix, exclude_subfolder)
    out = []
    for m in metas:
        content = svc.files().get_media(fileId=m["id"]).execute()
        out.append({"subfolder": m["subfolder"], "name": m["name"], "content": content})
    return out
