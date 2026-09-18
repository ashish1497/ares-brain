"""Shared-Drive read/write primitives for the collaborative data layer
(materials, transcripts, GUIDE.md, opt-in notes/testprep). Never touches
attendance or assignments — those code paths don't call this module.
No LLM, no LMS contact."""
import json
import re
from pathlib import Path

import yaml

import google_auth

_FOLDER_NAME_TO_SUBDIR = {
    "materials": "materials",
    "transcripts": "transcripts",
    "guide": "guide",
}

_FENCE = re.compile(r"^---\n(.*?)\n---\n(.*)\Z", re.DOTALL)

# ingest.py only calls write_if_absent for content it JUST normalized on this
# run (the diff-write skip means an unchanged file never re-triggers the
# share call) — so a course that already had materials/transcripts ingested
# BEFORE its Drive folder was registered gets nothing pushed, silently,
# forever, until something changes. backfill_course() is the one-time catch-up:
# push everything currently on disk regardless of ingest's diff state.
# write_if_absent's own content-hash check still makes this idempotent to
# re-run — nothing gets duplicated on Drive.
_NORMALIZED_TYPE_TO_PREFIX = {
    "material": "materials",
    "outline": "outline",
    "announcement": "announcements",
    "transcript": "transcripts",
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


def create_folder(name: str) -> str | None:
    """Create a new Drive folder at root and return its id. The app only
    holds the `drive.file` scope, so it can only ever see folders it
    creates itself — there's no way to search for/reuse an existing folder
    by name from here, by design."""
    svc = _drive_service()
    if svc is None:
        return None
    metadata = {"name": name, "mimeType": "application/vnd.google-apps.folder"}
    created = svc.files().create(body=metadata, fields="id").execute()
    return created.get("id")


def share_with_domain(folder_id: str, domain: str, role: str = "reader") -> bool:
    """Grant every account on `domain` (e.g. the school's Google Workspace
    domain) access to a folder — NOT the open internet. Deliberately no
    `type: "anyone"` path here: these folders hold real class transcripts
    with classmates' names and voices, so sharing is domain- or
    email-restricted only."""
    svc = _drive_service()
    if svc is None:
        return False
    svc.permissions().create(
        fileId=folder_id,
        body={"type": "domain", "domain": domain, "role": role},
        fields="id",
    ).execute()
    return True


def share_all_with_domain(domain: str, role: str = "reader") -> dict:
    """Share every currently-registered course folder with `domain`. Returns
    per-course results so a single Drive-API hiccup on one folder doesn't
    hide whether the other 16 succeeded."""
    folders = _folders_config()
    done, errors = [], []
    for slug, folder_id in folders.items():
        try:
            share_with_domain(folder_id, domain, role)
            done.append(slug)
        except Exception as exc:  # noqa: BLE001 — one bad folder must not abort the rest
            errors.append(f"{slug}: {exc}")
    return {"ok": True, "shared": done, "errors": errors}


def setup_course(slug: str, course_name: str) -> dict:
    """One-shot: create a fresh Drive folder for a course that has none
    registered yet, register it, then backfill everything already on disk
    into it. Idempotent on the backfill half; NOT idempotent on folder
    creation — calling this twice for an already-registered course creates
    a second, orphaned folder, so callers must check folder_id_for_course
    first."""
    if folder_id_for_course(slug):
        return {"ok": False, "error": f"{slug!r} already has a folder registered"}
    folder_id = create_folder(f"Ares Brain — {course_name}")
    if not folder_id:
        return {"ok": False, "error": "Drive not authorized"}
    register_folder(slug, folder_id)
    result = backfill_course(slug)
    result["folderId"] = folder_id
    return result


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


def backfill_course(slug: str) -> dict:
    """One-time catch-up push: everything already on disk for this course
    (materials/outline/announcements/transcripts + GUIDE.md, if built) gets
    offered to write_if_absent, regardless of whether ingest's diff-write
    skipped it on the last run. Safe to re-run — write_if_absent's own
    content-hash check means nothing already on Drive gets duplicated."""
    import hashlib
    from paths import course_dir

    folder_id = folder_id_for_course(slug)
    if not folder_id:
        return {"ok": False, "error": f"no Drive folder registered for {slug!r}"}

    pushed, skipped, errors = [], [], []
    normalized = course_dir(slug) / "normalized"
    for path in sorted(normalized.glob("*.md")) if normalized.exists() else []:
        text = path.read_text(errors="replace")
        m = _FENCE.match(text)
        if not m:
            continue
        try:
            fm = yaml.safe_load(m.group(1)) or {}
        except yaml.YAMLError:
            continue
        prefix = _NORMALIZED_TYPE_TO_PREFIX.get(fm.get("type") if isinstance(fm, dict) else None)
        if not prefix:
            continue
        content = path.read_bytes()
        # Must match ingest.py's _body_hash(content.decode()) exactly (whole
        # file, not just the body) — otherwise this write's stored hash never
        # matches what a later real ingest run computes, and every ingest
        # after a backfill looks like a "changed" file forever.
        content_hash = hashlib.sha256(content).hexdigest()
        try:
            wrote = write_if_absent(slug, f"{prefix}/{path.name}", content, content_hash)
            (pushed if wrote else skipped).append(f"{prefix}/{path.name}")
        except Exception as exc:  # noqa: BLE001 — one bad file must not abort the whole backfill
            errors.append(f"{path.name}: {exc}")

    guide = course_dir(slug) / "brain" / "GUIDE.md"
    if guide.exists():
        content = guide.read_bytes()
        content_hash = hashlib.sha256(content).hexdigest()
        try:
            wrote = write_if_absent(slug, "guide/GUIDE.md", content, content_hash)
            (pushed if wrote else skipped).append("guide/GUIDE.md")
        except Exception as exc:  # noqa: BLE001
            errors.append(f"GUIDE.md: {exc}")

    return {"ok": True, "pushed": pushed, "alreadyOnDrive": skipped, "errors": errors}


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
