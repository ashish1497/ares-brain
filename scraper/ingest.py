"""Normalize the scraped raw/ tree + dropped inbox/ files into
courses/<slug>/normalized/*.md — the corpus sub-project B embeds."""
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

from paths import course_dir, courses_root, ensure, raw_dir, slugify
from scrape_steps import _read_or_none

import gsheet
from extract import extract_text
from html2md import html_to_markdown


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _input_hash(data) -> str:
    if isinstance(data, str):
        data = data.encode()
    return hashlib.sha256(data).hexdigest()


def _body_hash(body: str) -> str:
    return hashlib.sha256(body.encode()).hexdigest()


_FM_FENCE = re.compile(r"^---\n(.*?)\n---\n(.*)\Z", re.DOTALL)


def parse_frontmatter(text: str) -> tuple[dict, str]:
    """(frontmatter dict, body). Mirrors brain.parse_frontmatter; kept local so
    ingest does not import from brain."""
    m = _FM_FENCE.match(text)
    if not m:
        return {}, text
    fm: dict = {}
    for line in m.group(1).splitlines():
        mk = re.match(r"([A-Za-z0-9_-]+):\s*(.*)$", line)
        if mk and mk.group(2) != "":
            v = mk.group(2).strip()
            if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
                v = v[1:-1]
            fm[mk.group(1)] = v
    return fm, m.group(2)


def _yaml_scalar(v) -> str:
    """A valid YAML double-quoted scalar for any value (handles ':', '#',
    quotes, leading '-'/'[', newlines). JSON strings are valid YAML."""
    return json.dumps(str(v))


# Bump when the on-disk normalized/*.md format changes (frontmatter or body).
# A course whose manifest records an older version is fully re-normalized so the
# stale output is regenerated even when the input hash is unchanged.
# 2 = YAML-quoted frontmatter scalars era. Missing / 1 = pre-fix.
NORMALIZED_FORMAT_VERSION = 2


def _norm_dir(slug: str) -> Path:
    return course_dir(slug) / "normalized"


def _load_manifest(slug: str) -> dict:
    m = _read_or_none(_norm_dir(slug) / "_ingest.json")
    return m if m else {"sources": {}, "ingestedAt": None}


def _save_manifest(slug: str, manifest: dict) -> None:
    ensure(_norm_dir(slug))
    manifest["formatVersion"] = NORMALIZED_FORMAT_VERSION
    (_norm_dir(slug) / "_ingest.json").write_text(json.dumps(manifest, indent=1))


# in-process record of which stableName maps to which source, per run, per slug
_name_owner: dict[tuple[str, str], str] = {}


def write_normalized(slug: str, *, type_: str, source: str, title: str,
                     course_name: str, body: str, session: int | None = None,
                     due: str | None = None, recorded_on: str | None = None) -> Path:
    out = ensure(_norm_dir(slug))
    base = f"{type_}-{slugify(title or source)}"
    name = f"{base}.md"
    n = 2
    while (slug, name) in _name_owner and _name_owner[(slug, name)] != source:
        name = f"{base}-{n}.md"
        n += 1
    _name_owner[(slug, name)] = source

    fm = ["---", f"type: {type_}", f"source: {_yaml_scalar(source)}",
          f"title: {_yaml_scalar(title)}", f"course: {_yaml_scalar(course_name)}"]
    if session is not None:
        fm.append(f"session: {session}")
    if due is not None:
        fm.append(f"due: {_yaml_scalar(due)}")
    if recorded_on is not None:
        fm.append(f"recordedOn: {_yaml_scalar(recorded_on)}")
    fm.append(f"bodyHash: {_body_hash(body)}")
    fm.append(f"updatedAt: {_now()}")
    fm += ["---", ""]
    dest = out / name
    dest.write_text("\n".join(fm) + body.rstrip() + "\n")
    return dest


def _material_body(m: dict, slug: str) -> str:
    kind = m.get("kind")
    if kind == "file" and m.get("localPath"):
        try:
            return extract_text(raw_dir(slug) / m["localPath"])
        except Exception as exc:  # noqa: BLE001
            return f"(unextractable file: {exc})"
    if kind == "text":
        return html_to_markdown(m.get("content") or "")
    if kind == "link":
        return f"> {m.get('url') or '(no url)'}"
    return ""


def _diff_write(slug: str, *, key: str, input_hash: str, old_sources: dict,
                write):
    """Return (key, input_hash, path, was_written). Skip the write when the
    manifest already records this key with an identical hash and the output
    file still exists."""
    prev = old_sources.get(key)
    if prev and prev.get("hash") == input_hash:
        existing = course_dir(slug) / prev["outPath"]
        if existing.exists():
            _name_owner[(slug, Path(prev["outPath"]).name)] = key
            return (key, input_hash, existing, False)
    return (key, input_hash, write(), True)


def _normalize_materials(slug: str, course_name: str, old_sources: dict,
                         errors: list | None = None, claimed: set | None = None):
    errors = errors if errors is not None else []
    claimed = claimed or set()
    mats = _read_or_none(raw_dir(slug) / "materials.json") or []
    out = []
    for m in mats:
        try:
            key = f"api:material:{m['id']}"
            if key in claimed:
                continue
            h = _input_hash(json.dumps(m, sort_keys=True))
            session = m.get("session") if isinstance(m.get("session"), int) else None
            out.append(_diff_write(
                slug, key=key, input_hash=h, old_sources=old_sources,
                write=lambda m=m, key=key, session=session: write_normalized(
                    slug, type_="material", source=key,
                    title=m.get("title") or m["id"], course_name=course_name,
                    body=_material_body(m, slug), session=session)))
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{slug} _normalize_materials record: {exc}")
    return out


def _normalize_assignments(slug: str, course_name: str, old_sources: dict,
                           errors: list | None = None):
    errors = errors if errors is not None else []
    items = _read_or_none(raw_dir(slug) / "assignments.json") or []
    out = []
    for a in items:
        try:
            key = f"api:assignment:{a['id']}"
            h = _input_hash(json.dumps(a, sort_keys=True))

            def _write(a=a, key=key):
                body = html_to_markdown(a.get("instructions") or a.get("description") or "")
                facts = []
                if a.get("dueAt"):
                    facts.append(f"Due: {a['dueAt']}")
                if a.get("cutoffDate"):
                    facts.append(f"Cutoff: {a['cutoffDate']}")
                if a.get("submissionType"):
                    facts.append(f"Submission: {a['submissionType']}")
                facts.append(f"Group: {'yes' if a.get('isGroup') else 'no'}")
                full = (body + "\n\n" + "\n".join(facts)).strip()
                return write_normalized(
                    slug, type_="assignment", source=key,
                    title=a.get("title") or a["id"], course_name=course_name,
                    body=full, due=a.get("dueAt"))

            out.append(_diff_write(slug, key=key, input_hash=h,
                                   old_sources=old_sources, write=_write))
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{slug} _normalize_assignments record: {exc}")
    return out


def _normalize_transcripts(slug: str, course_name: str, old_sources: dict,
                           errors: list | None = None):
    errors = errors if errors is not None else []
    tdir = course_dir(slug) / "transcripts"
    out = []
    if not tdir.exists():
        return out
    for f in sorted(tdir.glob("*.md")):
        if f.name.startswith("_"):
            continue
        try:
            key = f"transcript:{f.stem}"
            raw_text = f.read_text()
            h = _input_hash(raw_text)
            if raw_text.startswith("---"):
                parts = re.split(r"^---\n.*?\n---\n", raw_text, maxsplit=1,
                                 flags=re.DOTALL)
                if len(parts) >= 2:
                    body = parts[-1].strip()
                else:
                    body = raw_text
                    errors.append(
                        f"{slug} _normalize_transcripts: could not split "
                        f"frontmatter from {f.name}")
            else:
                body = raw_text
            out.append(_diff_write(
                slug, key=key, input_hash=h, old_sources=old_sources,
                write=lambda f=f, key=key, body=body: write_normalized(
                    slug, type_="transcript", source=f"transcripts/{f.name}",
                    title=f.stem, course_name=course_name, body=body)))
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{slug} _normalize_transcripts record: {exc}")
    return out


def _outline_topic_id(slug: str):
    topics = _read_or_none(raw_dir(slug) / "topics.json") or []
    t = next((t for t in topics if t.get("type") == "outline"), None)
    return t.get("id") if t else None


def _normalize_outline(slug: str, course_name: str, old_sources: dict,
                       errors: list | None = None):
    """Return (results, claimed) where claimed is the set of api:material:<id>
    keys the outline consumed (so _normalize_materials skips them)."""
    errors = errors if errors is not None else []
    try:
        otid = _outline_topic_id(slug)
        if not otid:
            return [], set()
        mats = _read_or_none(raw_dir(slug) / "materials.json") or []
        om = next((m for m in mats if m.get("topicId") == otid
                   and m.get("kind") == "text"), None)
        if not om:
            return [], set()
        claimed = {f"api:material:{om['id']}"}
        sid = gsheet.sheet_id_from_html(om.get("content") or "")
        if not sid:
            # Not a Google Sheet outline: don't claim the material, let
            # _normalize_materials preserve it as a normal `material` doc.
            return [], set()
        csv_text = gsheet.fetch_csv(sid)
        if csv_text is None:
            body = (f"Outline sheet could not be fetched automatically. Open "
                    f"https://docs.google.com/spreadsheets/d/{sid}/edit and drop a "
                    f"CSV/MD export into inbox/{slug}/notes/.")
            key = f"outline:{sid}:unfetched"
            h = _input_hash(key)
        else:
            body = gsheet.csv_to_markdown_table(csv_text)
            key = f"outline:{sid}"
            h = _input_hash(csv_text)
        res = _diff_write(
            slug, key=key, input_hash=h, old_sources=old_sources,
            write=lambda: write_normalized(
                slug, type_="outline", source=f"api:material:{om['id']}",
                title="Outline", course_name=course_name, body=body))
        return [res], claimed
    except Exception as exc:  # noqa: BLE001
        errors.append(f"{slug} _normalize_outline record: {exc}")
        return [], set()


def _normalize_inbox(slug: str, course_name: str, old_sources: dict,
                     errors: list | None = None):
    errors = errors if errors is not None else []
    base = course_dir(slug) / "inbox"
    out = []
    for sub, type_ in (("notes", "self-note"), ("books", "book")):
        d = base / sub
        if not d.exists():
            continue
        for f in sorted(d.iterdir()):
            if not f.is_file() or f.name.startswith("."):
                continue
            if f.suffix.lower() == ".epub":
                continue
            try:
                key = f"inbox:{sub}:{f.name}"
                h = _input_hash(f.read_bytes())

                def _write(f=f, type_=type_, sub=sub):
                    if f.suffix.lower() in (".md", ".txt"):
                        body = f.read_text(errors="replace")
                    elif f.suffix.lower() in (".pdf", ".docx"):
                        try:
                            body = extract_text(f)
                        except Exception as exc:  # noqa: BLE001
                            body = f"(unextractable: {exc})"
                    else:
                        body = f.read_text(errors="replace")
                    return write_normalized(
                        slug, type_=type_, source=f"inbox/{sub}/{f.name}",
                        title=f.stem, course_name=course_name, body=body)

                if f.suffix.lower() not in (".md", ".txt", ".pdf", ".docx"):
                    continue
                out.append(_diff_write(slug, key=key, input_hash=h,
                                       old_sources=old_sources, write=_write))
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{slug} _normalize_inbox record: {exc}")
    return out


def _normalize_sessions(index_by_slug: dict, old_by_slug: dict, errors: list):
    """Global: one pass over courses/_events.json. Returns (results, failed)."""
    results: dict[str, list] = {}
    failed: set[str] = set()
    ev = _read_or_none(courses_root() / "_events.json")
    if not ev:
        return results, failed
    for e in ev.get("events", []) if isinstance(ev, dict) else []:
        slug = e.get("courseSlug") if isinstance(e, dict) else None
        try:
            if e.get("eventType") != "session":
                continue
            if slug not in index_by_slug:
                continue
            key = f"api:event:{e['id']}"
            body = "\n".join([
                f"{e.get('title') or 'Session'}",
                f"{e.get('startAt', '?')} – {e.get('endAt', '?')} "
                f"{e.get('timezone', '')}".strip(),
                f"Instructor: {e.get('instructorName') or 'n/a'}",
                f"Course: {e.get('courseName') or index_by_slug[slug]}",
            ])
            h = _input_hash(json.dumps(e, sort_keys=True))
            res = _diff_write(
                slug, key=key, input_hash=h,
                old_sources=old_by_slug.get(slug, {}),
                write=lambda e=e, key=key, body=body, slug=slug: write_normalized(
                    slug, type_="session", source=key,
                    title=e.get("title") or e["id"],
                    course_name=index_by_slug[slug], body=body))
            results.setdefault(slug, []).append(res)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{slug} _normalize_sessions record: {exc}")
            if slug:
                failed.add(slug)
    return results, failed


def _normalize_announcements(index_by_slug: dict, old_by_slug: dict, errors: list):
    results: dict[str, list] = {}
    failed: set[str] = set()
    prog = _read_or_none(courses_root() / "_announcements.json") or []
    per_course = {c: _read_or_none(raw_dir(c) / "announcements.json") or []
                  for c in index_by_slug}
    batches = [(s, items) for s, items in per_course.items()] + [(None, prog)]
    seen_keys: set[str] = set()
    for slug, items in batches:
        for a in items if isinstance(items, list) else []:
            target = slug or (a.get("courseSlug") if isinstance(a, dict) else None)
            try:
                if target not in index_by_slug:
                    continue
                key = f"api:announcement:{a['id']}"
                if key in seen_keys:
                    continue
                seen_keys.add(key)
                full_body = html_to_markdown(a.get("body") or "")
                body = full_body[:2000]
                if len(full_body) > 2000:
                    body += "\n\n(truncated)"
                h = _input_hash(json.dumps(a, sort_keys=True))
                res = _diff_write(
                    target, key=key, input_hash=h,
                    old_sources=old_by_slug.get(target, {}),
                    write=lambda a=a, key=key, body=body, target=target: write_normalized(
                        target, type_="announcement", source=key,
                        title=a.get("title") or a["id"],
                        course_name=index_by_slug[target], body=body))
                results.setdefault(target, []).append(res)
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{target} _normalize_announcements record: {exc}")
                if target:
                    failed.add(target)
    return results, failed


def _normalize_study_book_summaries(slug: str, course_name: str, old_sources: dict,
                                    errors: list | None = None):
    """Re-normalize study/book-*-summary.md (produced by /book-summary) into
    normalized/book-summary-*.md so book summaries become searchable via brain."""
    errors = errors if errors is not None else []
    d = course_dir(slug) / "study"
    out = []
    if not d.exists():
        return out
    for p in sorted(d.glob("book-*-summary.md")):
        try:
            key = f"study:book-summary:{p.stem}"
            h = _input_hash(p.read_bytes())
            fm, body = parse_frontmatter(p.read_text(errors="replace"))
            stem = p.stem
            if stem.startswith("book-"):
                stem = stem[len("book-"):]
            if stem.endswith("-summary"):
                stem = stem[: -len("-summary")]
            title = fm.get("title") or stem.replace("-", " ")
            out.append(_diff_write(
                slug, key=key, input_hash=h, old_sources=old_sources,
                write=lambda p=p, body=body, title=title: write_normalized(
                    slug, type_="book-summary", source=f"study/{p.name}",
                    title=title, course_name=course_name, body=body)))
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{slug} _normalize_study_book_summaries record: {exc}")
    return out


_NORMALIZERS_API = (_normalize_materials, _normalize_assignments,
                    _normalize_transcripts, _normalize_inbox,
                    _normalize_study_book_summaries)
_NORMALIZERS_GLOBAL = (_normalize_sessions, _normalize_announcements)


def step_ingest(index: list[dict], course: str | None = None) -> dict:
    _name_owner.clear()
    scope = [c for c in index if course is None or c["slug"] == course]
    per_course, errors = {}, []
    index_by_slug = {c["slug"]: c["name"] for c in scope}
    state: dict[str, dict] = {}

    for c in scope:
        slug, name = c["slug"], c["name"]
        manifest = _load_manifest(slug)
        old_sources = dict(manifest.get("sources") or {})
        # Stale on-disk format -> force a full re-normalize: the normalizers diff
        # against an empty manifest (so every source is re-written with current
        # formatting), but orphan detection still runs against the real manifest.
        stale_format = manifest.get("formatVersion", 1) < NORMALIZED_FORMAT_VERSION
        diff_sources = {} if stale_format else old_sources
        # Seed the stable-name registry from the manifest so filenames are stable
        # against prior runs, not just within-run write order. Without this, a
        # source that SKIPS (unchanged) never re-registers its filename and a
        # different changed source with a colliding slug could claim + overwrite it.
        for m_key, m_meta in old_sources.items():
            try:
                _name_owner[(slug, Path(m_meta["outPath"]).name)] = m_key
            except (KeyError, TypeError):
                pass
        st = {"manifest": manifest, "old_sources": old_sources,
              "diff_sources": diff_sources, "new_sources": {},
              "n_norm": 0, "n_skip": 0, "seen_keys": set(), "failed": False}
        state[slug] = st

        def _merge(results):
            for key, h, path, was_written in results:
                st["seen_keys"].add(key)
                rel = str(path.relative_to(course_dir(slug)))
                st["new_sources"][key] = {"hash": h, "outPath": rel}
                if was_written:
                    st["n_norm"] += 1
                else:
                    st["n_skip"] += 1

        # outline first, so it can claim its material before _normalize_materials
        item_errors: list = []
        try:
            o_results, claimed = _normalize_outline(slug, name, diff_sources, item_errors)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{slug} _normalize_outline: {exc}")
            st["failed"] = True
            o_results, claimed = [], set()
        if item_errors:
            errors.extend(item_errors)
            st["failed"] = True
        _merge(o_results)

        for fn in _NORMALIZERS_API:
            item_errors = []
            try:
                if fn is _normalize_materials:
                    results = fn(slug, name, diff_sources, item_errors, claimed)
                else:
                    results = fn(slug, name, diff_sources, item_errors)
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{slug} {fn.__name__}: {exc}")
                st["failed"] = True
                continue
            if item_errors:
                errors.extend(item_errors)
                st["failed"] = True
            _merge(results)

    # global normalizers: one pass each, merge per-slug results
    old_by_slug = {slug: st["diff_sources"] for slug, st in state.items()}
    for gfn in _NORMALIZERS_GLOBAL:
        try:
            gres, gfailed = gfn(index_by_slug, old_by_slug, errors)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{gfn.__name__}: {exc}")
            for st in state.values():
                st["failed"] = True
            continue
        for slug in gfailed:
            if slug in state:
                state[slug]["failed"] = True
        for slug, results in gres.items():
            st = state[slug]
            for key, h, path, was_written in results:
                st["seen_keys"].add(key)
                rel = str(path.relative_to(course_dir(slug)))
                st["new_sources"][key] = {"hash": h, "outPath": rel}
                if was_written:
                    st["n_norm"] += 1
                else:
                    st["n_skip"] += 1

    # orphan deletion + manifest persist, once both phases have contributed
    for slug, st in state.items():
        manifest = st["manifest"]
        old_sources, new_sources = st["old_sources"], st["new_sources"]
        seen_keys = st["seen_keys"]
        orphans = 0
        if st["failed"]:
            for key, meta in old_sources.items():
                if key not in seen_keys:
                    new_sources.setdefault(key, meta)
        else:
            for key, meta in old_sources.items():
                if key not in seen_keys:
                    p = course_dir(slug) / meta["outPath"]
                    if p.exists():
                        p.unlink()
                    orphans += 1
        manifest["sources"] = new_sources
        manifest["ingestedAt"] = _now()
        _save_manifest(slug, manifest)
        per_course[slug] = {"normalized": st["n_norm"], "skipped": st["n_skip"],
                            "orphansDeleted": orphans}
    return {"perCourse": per_course, "errors": errors}


def ensure_inbox_skeleton(index: list[dict]) -> None:
    for c in index:
        for sub in ("notes", "recordings", "books"):
            ensure(course_dir(c["slug"]) / "inbox" / sub)
    ensure(courses_root() / "inbox" / "_unsorted")
