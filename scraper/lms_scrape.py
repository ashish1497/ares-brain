"""Mesa ares-brain scraper CLI.

    python lms_scrape.py whoami
    python lms_scrape.py courses
    python lms_scrape.py all [--course SLUG] [--force] [--json]

`all` is what the `scrape` MCP tool runs. See docs/lms-api.md.
"""
import argparse
import json
import sys

import mesa_api
import paths
import scrape_steps


def _run_all(args) -> dict:
    client = mesa_api.client_from_env()
    cfg = mesa_api.load_config()
    try:
        full_index = scrape_steps.step_courses(client, cfg)
    except Exception as exc:  # noqa: BLE001
        return {
            "term": None, "courses": 0, "assignmentsUnassigned": 0,
            "events": 0, "errors": [f"courses: {exc}"],
        }

    # full_index drives the GLOBAL rollup steps (assignments/attendance/events/
    # announcements) so a --course run never drops the other courses' data.
    # scope_index is what this run actually scrapes per-course.
    scope_index = full_index
    if args.course:
        scope_index = [c for c in full_index if c["slug"] == args.course]
        if not scope_index:
            sys.exit(f"no course with slug {args.course!r}")

    errors: list[str] = []
    topics_by_slug: dict[str, list | None] = {}
    for course in scope_index:
        try:
            topics_by_slug[course["slug"]] = scrape_steps.step_topics(
                client, cfg, course, args.force)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{course['slug']} topics: {exc}")
            # None (not []) => "topics unknown"; skip materials/recordings below
            # so a transient topics failure can't overwrite a good manifest.
            topics_by_slug[course["slug"]] = None

    try:
        a_summary = scrape_steps.step_assignments(client, cfg, full_index)
    except Exception as exc:  # noqa: BLE001
        errors.append(f"assignments: {exc}")
        a_summary = {"unassigned": 0}
    for step in (scrape_steps.step_attendance, scrape_steps.step_events,
                 scrape_steps.step_announcements):
        try:
            step(client, cfg, full_index)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{step.__name__}: {exc}")

    e_count = 0
    try:
        e_count = len(json.loads(
            scrape_steps.global_file("_events.json").read_text())["events"])
    except Exception:  # noqa: BLE001
        pass

    for course in scope_index:
        if topics_by_slug.get(course["slug"]) is None:
            errors.append(
                f"{course['slug']}: skipped materials/recordings (topics failed)")
            continue
        for step in (scrape_steps.step_materials, scrape_steps.step_recordings):
            try:
                step(client, cfg, course, topics_by_slug[course["slug"]])
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{course['slug']} {step.__name__}: {exc}")
                print(f"  {course['slug']}: ERROR {exc}")

    try:
        import ingest as _i
        _i.ensure_inbox_skeleton(full_index)
        i_result = _i.step_ingest(full_index, args.course)
        errors.extend(i_result.get("errors", []))
    except Exception as exc:  # noqa: BLE001
        errors.append(f"ingest: {exc}")
        i_result = {"perCourse": {}}

    try:
        import brain as _b
    except Exception as exc:  # noqa: BLE001
        errors.append(f"brain-index import: {exc}")
        _b = None
    brains_indexed = 0
    if _b is not None:
        for c in full_index:
            if not (paths.course_dir(c["slug"]) / "normalized").is_dir():
                continue
            try:
                _b.ensure_course_md(c["slug"], c["name"])
                _b.build_index(c["slug"])
                brains_indexed += 1
            except Exception as exc:  # noqa: BLE001
                errors.append(f"brain-index {c['slug']}: {exc}")

    meta = json.loads(scrape_steps.global_file("_meta.json").read_text())
    return {
        "term": meta.get("termName"),
        "courses": len(scope_index),
        "assignmentsUnassigned": a_summary.get("unassigned", 0),
        "events": e_count,
        "normalized": sum(v["normalized"] for v in i_result["perCourse"].values()),
        "brainsIndexed": brains_indexed,
        "errors": errors,
    }


def run(argv: list[str]) -> dict | None:
    p = argparse.ArgumentParser(prog="lms_scrape.py")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("whoami")
    sub.add_parser("courses")
    a = sub.add_parser("all")
    a.add_argument("--course")
    a.add_argument("--force", action="store_true")
    a.add_argument("--json", action="store_true")
    t = sub.add_parser("transcribe")
    t.add_argument("--course")
    t.add_argument("--inbox", action="store_true")
    t.add_argument("--json", action="store_true")
    tu = sub.add_parser("transcribe-url")
    tu.add_argument("--course", required=True)
    tu.add_argument("--url", required=True)
    tu.add_argument("--title")
    tu.add_argument("--json", action="store_true")
    i = sub.add_parser("ingest")
    i.add_argument("--course")
    i.add_argument("--json", action="store_true")
    bi = sub.add_parser("brain-index")
    bi.add_argument("--course")
    bi.add_argument("--force", action="store_true")
    bi.add_argument("--json", action="store_true")
    bq = sub.add_parser("brain-query")
    bq.add_argument("--params", default="{}")
    bq.add_argument("--json", action="store_true")
    bs = sub.add_parser("brain-status")
    bs.add_argument("--course")
    bs.add_argument("--json", action="store_true")
    mg = sub.add_parser("brain-mark-guide")
    mg.add_argument("--course", required=True)
    mg.add_argument("--json", action="store_true")
    ns = sub.add_parser("next-session")
    ns.add_argument("--course", required=True)
    ns.add_argument("--json", action="store_true")
    bg = sub.add_parser("brain-get")
    bg.add_argument("--course", required=True)
    bg.add_argument("--path", required=True)
    bg.add_argument("--max-bytes", type=int, default=20000, dest="max_bytes")
    bg.add_argument("--json", action="store_true")
    bw = sub.add_parser("brain-write-study")
    bw.add_argument("--course", required=True)
    bw.add_argument("--name", required=True)
    bw.add_argument("--type", required=True, dest="type_")
    bw.add_argument("--course-name", default="")
    bw.add_argument("--sources", default="")
    bw.add_argument("--json", action="store_true")
    db = sub.add_parser("daily-brief")
    db.add_argument("--json", action="store_true")
    db.add_argument("--within-hours", type=int, default=72)
    db.add_argument("--changed-since-hours", type=int, default=26)
    cs = sub.add_parser("calendar-sync")
    cs.add_argument("--dry-run", action="store_true")
    cs.add_argument("--json", action="store_true")
    sub.add_parser("calendar-auth")
    args = p.parse_args(argv)

    if args.cmd == "whoami":
        client = mesa_api.client_from_env()
        me = client.get(mesa_api.load_config()["endpoints"]["me"])
        print(json.dumps(me, indent=1))
        return None
    if args.cmd == "courses":
        client = mesa_api.client_from_env()
        cfg = mesa_api.load_config()
        index = scrape_steps.step_courses(client, cfg)
        print(json.dumps(index, indent=1))
        return None
    if args.cmd == "transcribe":
        import transcribe as _t
        _idx_file = scrape_steps.global_file("_index.json")
        index = json.loads(_idx_file.read_text()) if _idx_file.exists() else []
        result = _t.step_transcribe(index, args.course, inbox_only=args.inbox)
        print(json.dumps(result) if args.json else json.dumps(result, indent=1))
        return result
    if args.cmd == "transcribe-url":
        import transcribe as _t
        result = _t.transcribe_url(args.course, args.url, args.title)
        print(json.dumps(result) if args.json else json.dumps(result, indent=1))
        return result
    if args.cmd == "ingest":
        import ingest as _i
        index = json.loads(scrape_steps.global_file("_index.json").read_text())
        _i.ensure_inbox_skeleton(index)
        result = _i.step_ingest(index, args.course)
        print(json.dumps(result) if args.json else json.dumps(result, indent=1))
        return result
    if args.cmd == "brain-index":
        import brain as _b
        index = json.loads(scrape_steps.global_file("_index.json").read_text())
        slugs = [args.course] if args.course else [c["slug"] for c in index]
        result = {s: _b.build_index(s, args.force) for s in slugs}
        print(json.dumps(result) if args.json else json.dumps(result, indent=1))
        return result
    if args.cmd == "brain-query":
        import brain as _b
        kw = json.loads(args.params)
        results = _b.query(kw.pop("course", None), **kw)
        payload = {"results": results}
        print(json.dumps(payload) if args.json else json.dumps(payload, indent=1))
        return payload
    if args.cmd == "brain-status":
        import brain as _b
        index = json.loads(scrape_steps.global_file("_index.json").read_text())
        slugs = [args.course] if args.course else [c["slug"] for c in index]
        result = [_b.brain_status(s) for s in slugs]
        print(json.dumps(result) if args.json else json.dumps(result, indent=1))
        return result
    if args.cmd == "brain-mark-guide":
        import brain as _b
        result = _b.mark_guide(args.course)
        payload = {"ok": True, "guideBuiltAt": result["guideBuiltAt"]}
        print(json.dumps(payload) if args.json else json.dumps(payload, indent=1))
        return result
    if args.cmd == "next-session":
        import brain as _b
        result = _b.next_session(args.course)
        print(json.dumps(result) if args.json else json.dumps(result, indent=1))
        return result
    if args.cmd == "brain-get":
        import brain as _b
        result = _b.get_doc(args.course, args.path, max_bytes=args.max_bytes)
        if result is None:
            print(json.dumps({"error": "not found"}))
            sys.exit(1)
        print(json.dumps(result) if args.json else json.dumps(result, indent=1))
        return result
    if args.cmd == "brain-write-study":
        import sys as _sys, brain as _b
        body = _sys.stdin.read()
        sources = [s.strip() for s in args.sources.split(",") if s.strip()]
        cname = args.course_name
        if not cname:
            idx = json.loads(scrape_steps.global_file("_index.json").read_text())
            cname = next((c["name"] for c in idx if c["slug"] == args.course), args.course)
        try:
            p = _b.write_study_artifact(args.course, args.name, type_=args.type_,
                                        course_name=cname, body=body, sources=sources)
        except ValueError as exc:
            payload = {"error": str(exc)}
            print(json.dumps(payload))
            sys.exit(1)
        payload = {"path": f"study/{p.name}"}
        print(json.dumps(payload))
        return payload
    if args.cmd == "daily-brief":
        import daily_brief as _db
        result = _db.build_daily_brief(within_hours=args.within_hours,
                                       changed_since_hours=args.changed_since_hours)
        print(json.dumps(result) if args.json else json.dumps(result, indent=1))
        return result
    if args.cmd == "calendar-sync":
        import calendar_sync as _cs
        result = _cs.run(dry_run=args.dry_run)
        print(json.dumps(result) if args.json else json.dumps(result, indent=1))
        return result
    if args.cmd == "calendar-auth":
        import calendar_sync as _cs
        r = _cs.do_auth()
        print(json.dumps(r, indent=1))
        return r
    summary = _run_all(args)
    print(json.dumps(summary) if getattr(args, "json", False)
          else json.dumps(summary, indent=1))
    return summary


def main_exit_code(argv: list[str]) -> int:
    """Run the CLI and map a failure-shaped result dict to exit code 1.

    `run()` stays pure (returns the dict); the process exit-code policy lives
    here so the dashboard doesn't show failed jobs as a green "done".
    """
    r = run(argv)
    if isinstance(r, dict) and (
        r.get("ok") is False or r.get("failed") or r.get("errors")
    ):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main_exit_code(sys.argv[1:]))
