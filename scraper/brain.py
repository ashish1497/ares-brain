"""Query layer over courses/<slug>/normalized/*.md: SQLite FTS5 full-text +
frontmatter-column filters, a next-session resolver, and guide-staleness
metadata. No embeddings, no LLM — but build_index() does perform a
best-effort, network-touching Drive read (drive_sync.list_shared /
list_shared_meta) to pull classmates' shared notes. That call is wrapped in
try/except so a Drive failure never blocks indexing, but it is NOT
timeout-bounded (see the comment at its call sites) — a genuinely hung
socket on that call can stall build_index, including on the query-triggered
lazy-rebuild path (_open()/_recover_db's force=True corruption-recovery
path). Known follow-up, not fixed here."""
import json
import re
import sqlite3
from datetime import date, datetime, timezone
from pathlib import Path

import yaml

import drive_sync
import student_identity
from paths import course_dir, courses_root, ensure

_FENCE = re.compile(r"^---\n(.*?)\n---\n(.*)\Z", re.DOTALL)
_SESSION_IN_TITLE = re.compile(r"\bsession\s*0*(\d+)\b", re.I)


def _read_or_none(path):
    return json.loads(path.read_text()) if path.exists() else None


def _title_session(title):
    m = _SESSION_IN_TITLE.search(title or "")
    return int(m.group(1)) if m else None


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _scalar(v) -> str:
    """A YAML double-quoted scalar for any value. Mirrors ingest._yaml_scalar."""
    return json.dumps(str(v))


def parse_frontmatter(text: str) -> tuple[dict, str]:
    m = _FENCE.match(text)
    if not m:
        return {}, text
    try:
        fm = yaml.safe_load(m.group(1)) or {}
        if not isinstance(fm, dict):
            return {}, text
    except yaml.YAMLError:
        return {}, text
    return fm, m.group(2)


def _safe_seg(s: str) -> bool:
    return bool(s) and "/" not in s and "\\" not in s and ".." not in s and s not in (".", "..")


def _course_root_ok(slug: str) -> bool:
    """slug resolves to a dir directly under courses_root(), no traversal."""
    if not _safe_seg(slug):
        return False
    root = courses_root().resolve()
    cd = course_dir(slug).resolve()
    return cd != root and root in cd.parents


def get_doc(slug: str, path: str, max_bytes: int | None = None) -> dict | None:
    if not _course_root_ok(slug) or "\x00" in path:
        return None
    base = (course_dir(slug) / "normalized").resolve()
    rel = path[len("normalized/"):] if path.startswith("normalized/") else path
    target = (base / rel).resolve()
    if base not in target.parents and target != base:
        return None
    if not target.is_file() or target.suffix != ".md":
        return None
    fm, body = parse_frontmatter(target.read_text(errors="replace"))
    # yaml.safe_load coerces bare ISO timestamps (e.g. an unquoted `updatedAt`)
    # to datetime/date, which json.dumps can't serialise — stringify them back.
    fm = {k: (v.isoformat() if isinstance(v, (datetime, date)) else v)
          for k, v in fm.items()}
    if max_bytes is not None:
        enc = body.encode()
        if len(enc) > max_bytes:
            body = enc[:max_bytes].decode(errors="ignore")
            body += f"\n\n[truncated — {max_bytes} of {len(enc)} bytes]"
    return {"path": f"normalized/{target.name}", "frontmatter": fm, "body": body}


def brain_dir(slug: str) -> Path:
    return course_dir(slug) / "brain"


def _normalized_files(slug: str) -> list[Path]:
    """Local corpus files under normalized/. Excludes underscore-prefixed
    manifests and materialized shared-note files (those are re-pulled and
    re-written by build_index each time from Drive, not local source
    material — indexing them here too would double-count them in the docs
    table and pollute the local-file fingerprint)."""
    nd = course_dir(slug) / "normalized"
    if not nd.exists():
        return []
    return sorted(p for p in nd.glob("*.md")
                  if not p.name.startswith("_") and not p.name.startswith("shared-note-"))


def _meta_path(slug: str) -> Path:
    return brain_dir(slug) / "_brain.json"


def _load_meta(slug: str) -> dict:
    p = _meta_path(slug)
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text()) or {}
    except (json.JSONDecodeError, OSError):
        return {}          # corrupt -> treat as absent, rebuild


def _save_meta(slug: str, meta: dict) -> None:
    ensure(brain_dir(slug))
    tmp = _meta_path(slug).with_suffix(".json.tmp")
    tmp.write_text(json.dumps(meta, indent=1))
    tmp.replace(_meta_path(slug))


def _ingest_hash_map(slug: str) -> dict:
    """{normalized-file basename: content hash} from normalized/_ingest.json."""
    m = _read_or_none(course_dir(slug) / "normalized" / "_ingest.json") or {}
    out = {}
    for v in (m.get("sources") or {}).values():
        op, h = v.get("outPath"), v.get("hash")
        if op and h:
            out[Path(op).name] = h
    return out


def _fingerprint(slug: str, files: list[Path], shared_signature=None) -> dict:
    """Content-hash per file from the ingest manifest; mtime fallback for files
    the manifest doesn't list (e.g. a hand-added test file). `shared_signature`
    folds in a cheap signature of the shared-notes state on Drive (see
    `_shared_notes_signature`) so a new/changed classmate note forces a
    rebuild even when no local file changed."""
    hashes = _ingest_hash_map(slug)
    fp = {p.name: hashes.get(p.name, p.stat().st_mtime) for p in files}
    if shared_signature is not None:
        fp["__shared__"] = shared_signature
    return fp


def _shared_notes_signature(slug: str) -> str:
    """Cheap signature over the shared notes currently on Drive for `slug`,
    used to detect a new/changed classmate note without a local file change.
    Best-effort: any failure yields "" (treated like "no shared notes")."""
    try:
        # NOTE: not timeout-bounded (see module docstring / I11 follow-up) — a
        # hung socket here can stall the caller; try/except only guards against
        # an exception, not a hang.
        shared = drive_sync.list_shared_meta(slug, "notes", exclude_subfolder=student_identity.my_name())
    except Exception:  # noqa: BLE001 — sharing is best-effort, never blocks indexing
        return ""
    pairs = sorted(f"{item['subfolder']}/{item['name']}" for item in shared)
    return "|".join(pairs)


def _manifest_hashes(slug: str) -> set[str]:
    m = _read_or_none(course_dir(slug) / "normalized" / "_ingest.json") or {}
    return {v["hash"] for v in (m.get("sources") or {}).values() if v.get("hash")}


def mark_guide(slug: str) -> dict:
    meta = _load_meta(slug)
    meta["guideBuiltAt"] = _now()
    meta["guideSourceHashes"] = sorted(_manifest_hashes(slug))
    _save_meta(slug, meta)
    return meta


_COURSE_MD_TEMPLATE = """# {name} — my focus notes
<!-- Edit freely. Loaded as context whenever the agent answers about this course. -->

## What the professor emphasises

## Exam / assessment style

## Topics I'm weak on

## Things to remember
"""


def ensure_course_md(slug: str, course_name: str) -> Path:
    ensure(brain_dir(slug))
    p = brain_dir(slug) / "course.md"
    if not p.exists():
        p.write_text(_COURSE_MD_TEMPLATE.format(name=course_name))
    return p


def brain_status(slug: str) -> dict:
    meta = _load_meta(slug)
    files = _normalized_files(slug)
    current = _manifest_hashes(slug)
    covered = set(meta.get("guideSourceHashes") or [])
    corpus_bytes = meta.get("corpusBytes")
    if corpus_bytes is None:
        corpus_bytes = sum(
            len(parse_frontmatter(p.read_text(errors="replace"))[1].encode())
            for p in files
        )
    # indexFingerprint may carry a "__shared__" key (see _fingerprint) reflecting
    # Drive state at last build; strip it for this local-only staleness check so
    # brain_status stays a pure, network-free read.
    stored_fp = dict(meta.get("indexFingerprint") or {})
    stored_fp.pop("__shared__", None)
    return {
        "slug": slug,
        "corpusBytes": corpus_bytes,
        "sourceCount": len(files),
        "indexBuiltAt": meta.get("indexBuiltAt"),
        "indexStale": stored_fp != _fingerprint(slug, files),
        "guideBuiltAt": meta.get("guideBuiltAt"),
        "guideSourcesBehind": len(current - covered),
        "embeddingsRecommended": corpus_bytes > 150_000,
        "studyArtifacts": len(list_study(slug)),
    }


def drive_checklist(slugs_to_names: dict) -> list[dict]:
    """Local-only (no Drive API calls, no rate limits) per-course view of
    what SHOULD end up on Drive vs. what's on disk right now: is the folder
    even registered, and how much of the local corpus is share-eligible
    (material/outline/announcement/transcript-typed + a built guide) so a
    course sitting at "registered but nothing pushed yet" is visible without
    reaching for drive-browse per course."""
    folders = drive_sync._folders_config()
    out = []
    for slug, name in slugs_to_names.items():
        registered = slug in folders
        normalized = course_dir(slug) / "normalized"
        shareable = 0
        if normalized.exists():
            for p in normalized.glob("*.md"):
                fm, _ = parse_frontmatter(p.read_text(errors="replace"))
                if fm.get("type") in drive_sync._NORMALIZED_TYPE_TO_PREFIX:
                    shareable += 1
        has_guide = (brain_dir(slug) / "GUIDE.md").exists()
        out.append({
            "slug": slug,
            "name": name,
            "registered": registered,
            "folderId": folders.get(slug),
            "shareableLocalFiles": shareable,
            "hasGuide": has_guide,
        })
    return out


def study_dir(slug: str) -> Path:
    return course_dir(slug) / "study"


def _source_hash_map(slug: str) -> dict:
    m = _read_or_none(course_dir(slug) / "normalized" / "_ingest.json") or {}
    return {v["outPath"]: v.get("hash", "")
            for v in (m.get("sources") or {}).values() if v.get("outPath")}


def write_study_artifact(slug: str, name: str, *, type_: str, course_name: str,
                         body: str, sources: list[str]) -> Path:
    if not _course_root_ok(slug):
        raise ValueError(f"invalid course slug: {slug!r}")
    if not _safe_seg(name) or name.startswith("."):
        raise ValueError(f"invalid study artifact name: {name!r}")
    hmap = _source_hash_map(slug)
    fm = ["---", f"type: {_scalar(type_)}", f"course: {_scalar(course_name)}",
          f"generatedAt: {_scalar(_now())}"]
    if sources:
        fm.append("sources:")
        fm += [f"  - {_scalar(s)}" for s in sources]
        fm.append("sourceHashes:")
        fm += [f"  - {_scalar(hmap.get(s, ''))}" for s in sources]
    else:
        fm += ["sources: []", "sourceHashes: []"]
    fm += ["---", ""]
    base = ensure(study_dir(slug)).resolve()
    dest = (base / f"{name}.md").resolve()
    if base not in dest.parents:
        raise ValueError(f"invalid study artifact name: {name!r}")
    dest.write_text("\n".join(fm) + body.rstrip() + "\n")
    return dest


def list_study(slug: str) -> list[dict]:
    d = study_dir(slug)
    if not d.exists():
        return []
    out = []
    for p in sorted(d.glob("*.md")):
        fm, _ = parse_frontmatter(p.read_text(errors="replace"))
        out.append({"name": p.stem, "type": fm.get("type"), "generatedAt": fm.get("generatedAt")})
    return out


def read_study(slug: str, name: str) -> str | None:
    """Body of one study/testprep artifact (frontmatter stripped) for the
    dashboard reader. Same path-safety as write_study_artifact — a study
    name never escapes study_dir."""
    if not _course_root_ok(slug) or not _safe_seg(name) or name.startswith("."):
        return None
    base = study_dir(slug).resolve()
    target = (base / f"{name}.md").resolve()
    if base not in target.parents or not target.is_file():
        return None
    _fm, body = parse_frontmatter(target.read_text(errors="replace"))
    return body


def build_index(slug: str, force: bool = False) -> dict:
    files = _normalized_files(slug)
    meta = _load_meta(slug)
    if not files:
        # No corpus: do NOT destroy an existing index or overwrite _brain.json.
        return {"indexed": 0, "skipped": True, "reason": "no normalized corpus"}
    shared_sig = _shared_notes_signature(slug)
    fp = _fingerprint(slug, files, shared_sig)
    if not force and meta.get("indexFingerprint") == fp and (brain_dir(slug) / "index.sqlite").exists():
        return {"indexed": len(files), "skipped": True, "corpusBytes": meta.get("corpusBytes", 0)}

    ensure(brain_dir(slug))
    db = brain_dir(slug) / "index.sqlite"
    if db.exists():
        db.unlink()
    con = sqlite3.connect(db)
    con.execute(
        "CREATE VIRTUAL TABLE docs USING fts5("
        "path UNINDEXED, course UNINDEXED, type UNINDEXED, "
        "session UNINDEXED, due UNINDEXED, title, body, "
        "sharedBy UNINDEXED, "
        "tokenize = 'porter unicode61')"
    )
    corpus_bytes = 0
    for p in files:
        text = p.read_text(errors="replace")
        fm, body = parse_frontmatter(text)
        corpus_bytes += len(body.encode())
        con.execute(
            "INSERT INTO docs (path, course, type, session, due, title, body, sharedBy) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, '')",
            (f"normalized/{p.name}", fm.get("course", ""), fm.get("type", ""),
             str(fm.get("session", "")), fm.get("due", ""),
             fm.get("title", p.stem), body),
        )

    try:
        # NOTE: not timeout-bounded — see module docstring / I11 follow-up.
        shared = drive_sync.list_shared(slug, "notes", exclude_subfolder=student_identity.my_name())
    except Exception:  # noqa: BLE001 — sharing is best-effort, never blocks indexing
        shared = []
    if shared:
        ensure(course_dir(slug) / "normalized")
    for item in shared:
        fm, body = parse_frontmatter(item["content"].decode(errors="replace"))
        # Materialize to disk under normalized/ so the citation is actually
        # openable via get_doc (brain_get only serves courses/<slug>/normalized/*).
        local_name = f"shared-note-{item['subfolder']}-{item['name']}"
        (course_dir(slug) / "normalized" / local_name).write_text(item["content"].decode(errors="replace"))
        con.execute(
            "INSERT INTO docs (path, course, type, session, due, title, body, sharedBy) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (f"normalized/{local_name}", fm.get("course", ""),
             fm.get("type", "self-note"), str(fm.get("session", "")), fm.get("due", ""),
             fm.get("title", item["name"]), body, item["subfolder"]),
        )
    con.commit()
    con.close()

    meta.update({
        "indexBuiltAt": _now(), "sourceCount": len(files),
        "corpusBytes": corpus_bytes, "indexFingerprint": fp,
    })
    _save_meta(slug, meta)
    return {"indexed": len(files), "skipped": False, "corpusBytes": corpus_bytes}


def _open(slug: str) -> sqlite3.Connection:
    db = brain_dir(slug) / "index.sqlite"
    if not db.exists():
        build_index(slug)
    con = sqlite3.connect(db)
    con.row_factory = sqlite3.Row
    return con


def _all_slugs_with_normalized() -> list[str]:
    root = courses_root()
    if not root.exists():
        return []
    return sorted(d.name for d in root.iterdir()
                  if d.is_dir() and not d.name.startswith("_")
                  and (d / "normalized").exists())


def query(slug, *, type=None, session_min=None, session_max=None,
          due_before=None, text=None, limit=20) -> list[dict]:
    slugs = [slug] if slug else _all_slugs_with_normalized()
    out: list[dict] = []
    for s in slugs:
        rows = _query_one(s, type, session_min, session_max, due_before, text, limit)
        for r in rows:
            d = dict(r)
            d["session"] = int(d["session"]) if str(d["session"]).isdigit() else None
            d["snippet"] = (d["snippet"] or "").strip()
            d["sharedBy"] = d.get("sharedBy", "") or ""
            out.append(d)
    if text:
        out.sort(key=lambda d: d["score"])
    return out[:limit]


def _query_one(s, type, session_min, session_max, due_before, text, limit,
               _retried: bool = False):
    try:
        con = _open(s)
    except sqlite3.DatabaseError:
        con = None
    if con is None:
        return _recover_db(s, type, session_min, session_max, due_before, text,
                           limit, _retried)
    try:
        where, params = [], []
        if type:
            where.append("type = ?"); params.append(type)
        if session_min is not None:
            where.append("CAST(NULLIF(session,'') AS INTEGER) >= ?"); params.append(session_min)
        if session_max is not None:
            where.append("CAST(NULLIF(session,'') AS INTEGER) <= ?"); params.append(session_max)
        if due_before:
            where.append("due != '' AND due < ?"); params.append(due_before)
        if text:
            where.append("docs MATCH ?"); params.append(text)
            order = "bm25(docs)"
            sel = "snippet(docs, 6, '', '', ' … ', 12) AS snippet, bm25(docs) AS score"
        else:
            order = "CAST(NULLIF(session,'') AS INTEGER), due"
            sel = "substr(body, 1, 300) AS snippet, 0.0 AS score"
        sql = (f"SELECT path, course, type, session, due, title, sharedBy, {sel} FROM docs"
               + (f" WHERE {' AND '.join(where)}" if where else "")
               + f" ORDER BY {order} LIMIT ?")
        params.append(limit)
        try:
            return con.execute(sql, params).fetchall()
        except sqlite3.DatabaseError as exc:
            # malformed FTS query -> empty; corrupt db ("file is not a database")
            # -> rebuild once and retry.
            if isinstance(exc, sqlite3.OperationalError) and "malformed" not in str(exc):
                return []
            if "not a database" in str(exc) or "malformed" in str(exc):
                if not _retried:
                    con.close()
                    con = None
                    return _recover_db(s, type, session_min, session_max,
                                       due_before, text, limit, _retried)
            return []
    finally:
        if con is not None:
            con.close()


def _recover_db(s, type, session_min, session_max, due_before, text, limit,
                _retried):
    if _retried:
        return []
    db = brain_dir(s) / "index.sqlite"
    try:
        if db.exists():
            db.unlink()
        build_index(s, force=True)
    except Exception:  # noqa: BLE001
        return []
    try:
        return _query_one(s, type, session_min, session_max, due_before, text,
                          limit, _retried=True)
    except sqlite3.DatabaseError:
        return []


_OUTLINE_KEYS = {"session": ("session",), "date": ("date",), "topic": ("topic",),
                 "preRead": ("pre-read", "preread", "reading")}


def _first_markdown_table(body: str) -> list[list[str]]:
    rows: list[list[str]] = []
    for line in body.splitlines():
        line = line.strip()
        if line.startswith("|") and line.endswith("|"):
            cells = [c.strip() for c in line.strip("|").split("|")]
            if set("".join(cells)) <= set("-: "):   # separator row
                continue
            rows.append(cells)
        elif rows:
            break
    return rows


def parse_outline(slug: str) -> dict:
    files = [p for p in _normalized_files(slug)
             if parse_frontmatter(p.read_text(errors="replace"))[0].get("type") == "outline"]
    if not files:
        return {"columns": [], "rows": [], "structured": False}
    _, body = parse_frontmatter(files[0].read_text(errors="replace"))
    table = _first_markdown_table(body)
    if not table:
        return {"columns": [], "rows": [], "structured": False}
    header, *data = table
    lower = [h.lower() for h in header]
    colmap: dict[str, int] = {}
    for field, needles in _OUTLINE_KEYS.items():
        for i, h in enumerate(lower):
            if any(n in h for n in needles):
                colmap[field] = i
                break
    structured = {"session", "date", "topic"} <= colmap.keys()
    if not structured:
        return {"columns": header, "rows": [r for r in data], "structured": False}
    rows = []
    for r in data:
        rows.append({f: (r[i] if i < len(r) else "") for f, i in colmap.items()})
    return {"columns": header, "rows": rows, "structured": True}


def _load_json(name: str):
    return _read_or_none(courses_root() / name)


def _parse_iso(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def _try_date(s: str):
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(s.strip(), fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def next_session(slug: str, now: datetime | None = None) -> dict | None:
    now = now or datetime.now(timezone.utc)
    att = (_load_json("_attendance.json") or {}).get("byCourse", {}).get(slug, {})
    conducted = att.get("sessionsConducted") or 0
    nxt = conducted + 1

    ev = (_load_json("_events.json") or {}).get("events", [])
    future = sorted(
        (e for e in ev if e.get("eventType") == "session"
         and e.get("courseSlug") == slug and e.get("startAt")
         and _parse_iso(e["startAt"]) > now),
        key=lambda e: e["startAt"])
    outline = parse_outline(slug)
    orow = None
    if outline["structured"]:
        orow = next((r for r in outline["rows"] if r.get("session") == str(nxt)), None)

    if future:
        e = future[0]
        result = {
            "sessionsConducted": conducted, "nextIndex": nxt,
            "startAt": e["startAt"], "endAt": e.get("endAt"),
            "title": e.get("title"), "outlineRow": orow, "source": "events",
        }
    elif outline["structured"]:
        future_rows = [r for r in outline["rows"]
                       if r.get("date") and (d := _try_date(r["date"])) and d >= now]
        if not future_rows:
            return None
        r = future_rows[0]
        result = {
            "sessionsConducted": conducted,
            "nextIndex": int(r["session"]) if r["session"].isdigit() else nxt,
            "startAt": r["date"], "endAt": None, "title": r.get("topic"),
            "outlineRow": r, "source": "outline",
        }
    else:
        return None

    idx = result["nextIndex"]
    prim = [r["path"] for r in query(slug, type="material", session_min=idx, session_max=idx)]
    result["prereadPaths"] = prim or [
        r["path"] for r in query(slug, type="material", limit=200)
        if _title_session(r["title"]) == idx
    ]
    return result
