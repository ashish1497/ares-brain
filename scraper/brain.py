"""Query layer over courses/<slug>/normalized/*.md: SQLite FTS5 full-text +
frontmatter-column filters, a next-session resolver, and guide-staleness
metadata. No embeddings, no LLM."""
import json
import re
import sqlite3
from datetime import date, datetime, timezone
from pathlib import Path

import yaml

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
    nd = course_dir(slug) / "normalized"
    if not nd.exists():
        return []
    return sorted(p for p in nd.glob("*.md") if not p.name.startswith("_"))


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


def _fingerprint(slug: str, files: list[Path]) -> dict:
    """Content-hash per file from the ingest manifest; mtime fallback for files
    the manifest doesn't list (e.g. a hand-added test file)."""
    hashes = _ingest_hash_map(slug)
    return {p.name: hashes.get(p.name, p.stat().st_mtime) for p in files}


def _manifest_hashes(slug: str) -> set[str]:
    m = _read_or_none(course_dir(slug) / "normalized" / "_ingest.json") or {}
    return {v["hash"] for v in (m.get("sources") or {}).values() if v.get("hash")}


def mark_guide(slug: str) -> dict:
    meta = _load_meta(slug)
    meta["guideBuiltAt"] = _now()
    meta["guideSourceHashes"] = sorted(_manifest_hashes(slug))
    _save_meta(slug, meta)
    return meta


def mark_drill(slug: str) -> dict:
    meta = _load_meta(slug)
    meta["drillBuiltAt"] = _now()
    meta["drillSourceHashes"] = sorted(_manifest_hashes(slug))
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
    drill_covered = set(meta.get("drillSourceHashes") or [])
    corpus_bytes = meta.get("corpusBytes")
    if corpus_bytes is None:
        corpus_bytes = sum(
            len(parse_frontmatter(p.read_text(errors="replace"))[1].encode())
            for p in files
        )
    return {
        "slug": slug,
        "corpusBytes": corpus_bytes,
        "sourceCount": len(files),
        "indexBuiltAt": meta.get("indexBuiltAt"),
        "indexStale": meta.get("indexFingerprint") != _fingerprint(slug, files),
        "guideBuiltAt": meta.get("guideBuiltAt"),
        "guideSourcesBehind": len(current - covered),
        "drillBuiltAt": meta.get("drillBuiltAt"),
        "drillSourcesBehind": len(current - drill_covered),
        "embeddingsRecommended": corpus_bytes > 150_000,
        "studyArtifacts": len(list_study(slug)),
    }


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


def build_index(slug: str, force: bool = False) -> dict:
    files = _normalized_files(slug)
    meta = _load_meta(slug)
    if not files:
        # No corpus: do NOT destroy an existing index or overwrite _brain.json.
        return {"indexed": 0, "skipped": True, "reason": "no normalized corpus"}
    fp = _fingerprint(slug, files)
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
        "tokenize = 'porter unicode61')"
    )
    corpus_bytes = 0
    for p in files:
        text = p.read_text(errors="replace")
        fm, body = parse_frontmatter(text)
        corpus_bytes += len(body.encode())
        con.execute(
            "INSERT INTO docs (path, course, type, session, due, title, body) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (f"normalized/{p.name}", fm.get("course", ""), fm.get("type", ""),
             str(fm.get("session", "")), fm.get("due", ""),
             fm.get("title", p.stem), body),
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
        sql = (f"SELECT path, course, type, session, due, title, {sel} FROM docs"
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
