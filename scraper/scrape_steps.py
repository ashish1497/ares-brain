"""One function per scraper subcommand. Each writes files and returns a summary."""
import json
import os
import requests
from datetime import datetime, timezone, timedelta

import mesa_api
from paths import slugify, global_file, courses_root, ensure, raw_dir


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _write_json(path, data) -> None:
    ensure(path.parent)
    path.write_text(json.dumps(data, indent=1))


def discover_term(client, cfg) -> dict:
    override = os.environ.get("MESA_TERM_ID") or cfg.get("termIdOverride")
    summary = client.get(cfg["endpoints"]["attendanceSummary"]) or []
    if override:
        row = next((r for r in summary if r.get("termId") == override), None)
        return {"termId": override, "termName": (row or {}).get("termName", "")}
    if not summary:
        raise mesa_api.ApiError("attendance summary empty - cannot discover term")
    first = summary[0]
    term_id = first.get("termId")
    if not term_id:
        raise mesa_api.ApiError("attendance summary rows have no termId")
    return {"termId": term_id, "termName": first.get("termName", "")}


def _read_or_none(path):
    return json.loads(path.read_text()) if path.exists() else None


def step_topics(client, cfg, course: dict, force: bool = False) -> list[dict]:
    out = raw_dir(course["slug"])
    ensure(out)
    dest = out / "topics.json"
    cached = None if force else _read_or_none(dest)
    if cached is not None:
        return cached
    topics = (client.get(cfg["endpoints"]["topics"], {"courseId": course["id"]}) or {}).get("topics", [])
    _write_json(dest, topics)
    return topics


def topics_by_type(topics: list[dict]) -> dict:
    return {t["type"]: t for t in topics}


_ASSIGNMENT_FIELDS = ("id", "title", "courseId", "courseName", "topicId",
                      "instructions", "submissionType", "isGroup", "dueAt",
                      "cutoffDate", "allowLate", "status", "mySubmissionStatus",
                      "materials", "createdAt")


def _slim_assignment(a: dict) -> dict:
    out = {k: a.get(k) for k in _ASSIGNMENT_FIELDS}
    if out["courseName"] is None:
        out["courseName"] = a.get("courseTitle")
    return out


def step_assignments(client, cfg, index: list[dict]) -> dict:
    mine = (client.get(cfg["endpoints"]["assignmentsMy"]) or {}).get("assignments", [])
    merged: dict[str, dict] = {}
    for a in mine:
        merged[a["id"]] = a
    for course in index:
        rows = (client.get(cfg["endpoints"]["assignmentsByCourse"],
                           {"courseId": course["id"], "status": "published"}) or {}).get("assignments", [])
        for a in rows:
            prev = merged.get(a["id"])
            if prev is None or (prev.get("courseId") is None and a.get("courseId")):
                merged[a["id"]] = a

    # topicId -> slug, from each course's cached topics.json
    topic_owner: dict[str, str] = {}
    for course in index:
        for t in (_read_or_none(raw_dir(course["slug"]) / "topics.json") or []):
            topic_owner[t["id"]] = course["slug"]
    slug_by_course_id = {c["id"]: c["slug"] for c in index}

    buckets: dict[str, list] = {c["slug"]: [] for c in index}
    unassigned: list = []
    for a in merged.values():
        slim = _slim_assignment(a)
        slug = slug_by_course_id.get(a.get("courseId")) or topic_owner.get(a.get("topicId"))
        (buckets[slug] if slug in buckets else unassigned).append(slim)

    for course in index:
        _write_json(raw_dir(course["slug"]) / "assignments.json", buckets[course["slug"]])
    _write_json(global_file("_assignments-unassigned.json"), unassigned)
    return {"perCourse": {s: len(v) for s, v in buckets.items()}, "unassigned": len(unassigned)}


def step_courses(client, cfg) -> list[dict]:
    ensure(courses_root())
    term = discover_term(client, cfg)
    me = client.get(cfg["endpoints"]["me"]) or {}
    student_id = (me.get("user") or {}).get("id", "")

    listed = (client.get(cfg["endpoints"]["courses"], {"termId": term["termId"]}) or {}).get("courses", [])
    summary = client.get(cfg["endpoints"]["attendanceSummary"]) or []

    by_id: dict[str, dict] = {}
    for c in listed:
        by_id[c["id"]] = {
            "id": c["id"], "name": c["title"], "slug": slugify(c["title"]),
            "instructorName": c.get("instructorName"),
            "courseType": c.get("courseType"), "classType": c.get("classType"),
        }
    for r in summary:
        cid = r.get("courseId")
        if cid and cid not in by_id:
            by_id[cid] = {
                "id": cid, "name": r["courseName"], "slug": slugify(r["courseName"]),
                "instructorName": None, "courseType": None, "classType": None,
            }

    index = sorted(by_id.values(), key=lambda c: c["name"].lower())
    _write_json(global_file("_index.json"), index)
    _write_json(global_file("_meta.json"), {
        "termId": term["termId"], "termName": term["termName"],
        "studentId": student_id, "scrapedAt": _now(),
    })
    print(f"  courses: {len(index)} in {term['termName']}")
    return index


def step_attendance(client, cfg, index: list[dict]) -> dict:
    summary = client.get(cfg["endpoints"]["attendanceSummary"]) or []
    slug_by_id = {c["id"]: c["slug"] for c in index}
    slug_by_name = {c["name"]: c["slug"] for c in index}
    by_course = {}
    for r in summary:
        slug = slug_by_id.get(r.get("courseId")) or slug_by_name.get(r.get("courseName"))
        if not slug:
            continue
        by_course[slug] = {
            "courseId": r.get("courseId"),
            "sessionsConducted": r.get("total"),
            "attended": r.get("attended"),
            "percentage": r.get("percentage"),
            "avgCp": r.get("avgCp"),
        }
    _write_json(global_file("_attendance.json"), {"raw": summary, "byCourse": by_course})
    return {"courses": len(by_course)}


def step_events(client, cfg, index: list[dict]) -> dict:
    days = cfg.get("eventsWindowDays", 60)
    now = datetime.now(timezone.utc)
    frm = (now - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    to = (now + timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    payload = client.get(cfg["endpoints"]["eventsMy"], {"from": frm, "to": to}) or {}
    events = payload.get("events", [])
    slug_by_id = {c["id"]: c["slug"] for c in index}
    for e in events:
        if e.get("courseId") in slug_by_id:
            e["courseSlug"] = slug_by_id[e["courseId"]]
    _write_json(global_file("_events.json"), {"window": {"from": frm, "to": to}, "events": events})
    return {"events": len(events)}


def step_announcements(client, cfg, index: list[dict]) -> dict:
    slug_by_id = {c["id"]: c["slug"] for c in index}
    max_pages = cfg.get("announcementsMaxPages", 5)
    cutoff = datetime.now(timezone.utc) - timedelta(days=90)
    program, per_course = [], {}
    for page in range(1, max_pages + 1):
        rows = (client.get(cfg["endpoints"]["announcements"],
                           {"page": page, "limit": 20}) or {}).get("announcements", [])
        if not rows:
            break
        stop = False
        for a in rows:
            ts = a.get("publishedAt") or a.get("createdAt") or ""
            try:
                if ts and datetime.fromisoformat(ts.replace("Z", "+00:00")) < cutoff:
                    stop = True
                    continue
            except ValueError:
                pass
            slug = slug_by_id.get(a.get("courseId"))
            if slug:
                per_course.setdefault(slug, []).append(a)
            else:
                program.append(a)
        if stop:
            break
    _write_json(global_file("_announcements.json"), program)
    for slug, items in per_course.items():
        _write_json(raw_dir(slug) / "announcements.json", items)
    return {"program": len(program), "course": sum(len(v) for v in per_course.values())}


_MATERIAL_FIELDS = ("id", "topicId", "title", "category", "kind", "session",
                    "resourceSessionId", "fileName", "fileType", "sizeBytes",
                    "content", "url", "allowDownload", "updatedAt")


def _ext_for(m: dict) -> str:
    ft = (m.get("fileType") or "").lstrip(".")
    if ft:
        return ft
    name = m.get("fileName") or ""
    return name.rsplit(".", 1)[-1] if "." in name else "bin"


def step_materials(client, cfg, course: dict, topics: list[dict]) -> dict:
    out = raw_dir(course["slug"])
    ensure(out)
    files_dir = ensure(out / "files")
    manifest, n_files, n_errs = [], 0, 0
    for t in topics:
        mats = (client.get(cfg["endpoints"]["topicMaterials"].format(topicId=t["id"])) or {}).get("materials", [])
        for m in mats:
            entry = {k: m.get(k) for k in _MATERIAL_FIELDS}
            entry["topicType"] = t.get("type")
            entry["localPath"] = None
            if m.get("kind") == "file" and m.get("allowDownload"):
                dest = files_dir / f"{m['id']}.{_ext_for(m)}"
                if dest.exists():
                    entry["localPath"] = str(dest.relative_to(out))
                    n_files += 1
                else:
                    try:
                        signed = client.get(cfg["endpoints"]["materialSignedUrl"].format(materialId=m["id"])) or {}
                        url = signed.get("url") or signed.get("signedUrl")
                        if not url:
                            raise ValueError("no url in signed-url response")
                        resp = requests.get(url, timeout=60)
                        resp.raise_for_status()
                        dest.write_bytes(resp.content)
                        entry["localPath"] = str(dest.relative_to(out))
                        n_files += 1
                    except Exception as exc:
                        print(f"    file {m.get('fileName')!r}: {exc}")
                        n_errs += 1
            manifest.append(entry)
    _write_json(out / "materials.json", manifest)
    return {"materials": len(manifest), "files": n_files, "fileErrors": n_errs}


_RECORDING_FIELDS = ("id", "title", "videoUrl", "provider", "embedUrl",
                     "recordedOn", "durationSec")


def step_recordings(client, cfg, course: dict, topics: list[dict]) -> dict:
    out = ensure(raw_dir(course["slug"]))
    rec_topic = next((t for t in topics if t.get("type") == "recordings"), None)
    items = []
    if rec_topic:
        raw = (client.get(cfg["endpoints"]["topicRecordings"].format(topicId=rec_topic["id"])) or {}).get("recordings", [])
        items = [{k: r.get(k) for k in _RECORDING_FIELDS} for r in raw]
    _write_json(out / "recordings.json", items)
    return {"recordings": len(items)}
