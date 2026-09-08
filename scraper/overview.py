"""Outcome-dashboard data: where the student stands vs the grade — today, this
week, assignment risk, exams, attendance runway, brain readiness, gaps. Pure —
reads courses/ off disk, no LMS auth, no LLM. Mirrors daily_brief.py."""
import os
import re
import sys
import time
from datetime import datetime, timezone

import brain
import daily_brief
from paths import course_dir, global_file

_ATT_MIN = int(os.environ.get("ARES_BRAIN_ATTENDANCE_MIN", "75"))
_CHAT_UNLOCK = int(os.environ.get("ARES_BRAIN_CHAT_UNLOCK", "15"))

_ASSESS_HDR = re.compile(r"assessment\s+(?:and|&)\s+evaluation", re.I)
# "Name: 30%" — an inline weighted component inside one cell. The char class keeps
# ``()`` so parenthetical qualifiers ("Personal Branding (Component 1)") survive.
_INLINE_RE = re.compile(r"([A-Za-z][A-Za-z0-9 /&+.'()\-]*?)\s*:\s*(\d{1,3})\s*%")
_PCT_RE = re.compile(r"(\d{1,3})\s*%")
# A numbered outline section header ("3. Assessment ...", "4. Schedule ..."). Real
# outlines lead the digit with one or more pipe cells: "|  | 4. Rules  |".
_SECTION_RE = re.compile(r"^\s*(?:\|\s*)*\d+\.\s")
_JUNK_NAMES = {"", "a", "from mesa", "total", "component", "assessment", "evaluation"}


def _safe(fn, empty):
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001
        print(f"overview: {getattr(fn, '__name__', 'block')} failed: {exc}",
              file=sys.stderr)
        return empty


def _q(s: str) -> str:
    return (s or "").replace('"', "'")


def _name_match(a: str, b: str) -> bool:
    """True when ``a`` and ``b`` reference the same component — one is a
    word-boundary-delimited substring of the other. Avoids "Pitch 1" matching
    "Pitch 10"."""
    a, b = (a or "").strip(), (b or "").strip()
    if not a or not b:
        return False
    return bool(re.search(rf"\b{re.escape(a)}\b", b, re.I)
                or re.search(rf"\b{re.escape(b)}\b", a, re.I))


def _courses() -> list[dict]:
    idx = daily_brief._read_json(global_file("_index.json"))
    if not isinstance(idx, list):
        return []
    return [c for c in idx if isinstance(c, dict) and c.get("slug")]


def _outline_body(slug: str) -> str:
    nd = course_dir(slug) / "normalized"
    if not nd.exists():
        return ""
    for p in sorted(nd.glob("outline*.md")):
        try:
            _fm, body = brain.parse_frontmatter(p.read_text(errors="replace"))
        except Exception:  # noqa: BLE001
            continue
        if body.strip():
            return body
    return ""


def parse_assessment(outline_body: str) -> list[dict]:
    """Grade components + weights from an outline's assessment table.

    Tolerant of Mesa's ragged pipe tables: a component name in one cell and its
    weight in another, multiple ``Name: NN%`` pairs stacked in a single cell
    (which normalisation splits across physical lines), and a bare ``NN%`` whose
    name is the row's leading text cell. Returns ``[{name, weightPct}]``.
    """
    if not outline_body or "%" not in outline_body:
        return []
    lines = outline_body.splitlines()
    start = next((i for i, l in enumerate(lines) if _ASSESS_HDR.search(l)), None)
    if start is not None:
        block: list[str] = []
        for l in lines[start + 1:]:
            if _SECTION_RE.match(l) and not _ASSESS_HDR.search(l):
                break
            block.append(l)
        lines = block

    out: list[dict] = []
    seen: set[str] = set()
    last_label = ""

    def _clean(name: str) -> str:
        return re.sub(r"\s+", " ", (name or "").replace("|", " ").strip())

    def _add(name: str, pct: int) -> None:
        n = _clean(name)
        if not n or n.lower() in _JUNK_NAMES or n.lower() in seen:
            return
        if not 0 < pct <= 100:
            return
        seen.add(n.lower())
        out.append({"name": n, "weightPct": pct})

    parent_active = False  # a non-parenthetical component contributed on a prior line
    for raw in lines:
        cells = [c.strip() for c in raw.split("|") if c.strip()]
        if "%" not in raw:
            if cells and ":" not in raw:
                last_label = cells[0]
                parent_active = False
            continue
        added_nonparen = False
        for m in _INLINE_RE.finditer(raw):
            nm, pct = m.group(1), int(m.group(2))
            is_paren = raw[:m.start()].rstrip().endswith("(")
            if is_paren and (parent_active or added_nonparen):
                continue  # nested breakdown — the parent total already counts it
            before = len(out)
            _add(nm, pct)
            if not is_paren and len(out) > before:
                added_nonparen = True
        if added_nonparen:
            parent_active = True
        residual = _INLINE_RE.sub(" ", raw)
        bares = _PCT_RE.findall(residual)
        label = next((c for c in cells
                      if not _PCT_RE.search(c) and not _INLINE_RE.search(c)), "")
        for pct in bares:
            _add(label or last_label, int(pct))
        if label:
            last_label = label
    return out


def _pending_transcripts(slug: str) -> dict:
    recs = daily_brief._read_json(course_dir(slug) / "raw" / "recordings.json")
    recs = recs if isinstance(recs, list) else []
    tdir = course_dir(slug) / "transcripts"
    done = {p.stem for p in tdir.glob("*.md")} if tdir.exists() else set()
    items = []
    for r in recs:
        if not isinstance(r, dict) or not r.get("id"):
            continue
        if r["id"] in done or f"inbox-{r['id']}" in done:
            continue
        items.append({"title": r.get("title") or r["id"],
                      "recordedOn": r.get("recordedOn"),
                      "videoUrl": r.get("videoUrl")})
    return {"count": len(items), "items": items}


def attendance_runway(att: dict, sessions_to_mid: int, sessions_to_end: int,
                      minimum: int = _ATT_MIN) -> dict:
    """Attendance now, plus best-case and floor projections to each exam.

    ``state`` is one of:
    - ``"risk"``  — even perfect attendance keeps the endterm figure below
      ``minimum`` (unrecoverable), or the course is finished below ``minimum``.
    - ``"watch"`` — not risk, but at/below the line now, or one more miss drops
      below it.
    - ``"ok"``    — comfortably clear (or finished at/above ``minimum``).
    ``atRisk`` mirrors ``state != "ok"`` for callers that only want a bool.

    When ``sessions_to_end == 0`` the course is over: there are no sessions left
    to model, so the one-miss projection is skipped and the state is decided
    purely on ``now_pct`` vs ``minimum``.
    """
    try:
        a = int(att.get("attended") or 0)
    except (TypeError, ValueError):
        a = 0
    try:
        t = int(att.get("total") or 0)
    except (TypeError, ValueError):
        t = 0
    now_pct = round(a / t * 100, 1) if t else 0.0

    def _best(extra: int) -> int:
        denom = t + extra
        return round((a + extra) / denom * 100) if denom else 0

    bc_mid = _best(sessions_to_mid)
    bc_end = _best(sessions_to_end)
    floor = round(a / (t + sessions_to_end) * 100) if (t + sessions_to_end) else 0
    one_miss_pct = round(a / (t + 1) * 100)

    if sessions_to_end == 0:
        if now_pct >= minimum:
            state, note = "ok", ""
        else:
            state, note = "risk", f"finished at {now_pct:.0f}% — below {minimum}%"
    elif bc_end < minimum:
        state = "risk"
        note = f"even perfect attendance stays below {minimum}%"
    elif now_pct <= minimum or one_miss_pct < minimum:
        state = "watch"
        if now_pct == minimum and one_miss_pct >= minimum:
            note = f"sitting at exactly {minimum}%"
        else:
            note = f"one more miss drops below {minimum}%"
    else:
        state = "ok"
        note = ""
    at_risk = state != "ok"
    return {
        "attended": a, "conducted": t, "nowPct": now_pct,
        "avgCp": att.get("avgCp", 0),
        "sessionsLeftToMidterm": sessions_to_mid,
        "sessionsLeftToEndterm": sessions_to_end,
        "bestCaseMidtermPct": bc_mid, "bestCaseEndtermPct": bc_end,
        "floorEndtermPct": floor, "state": state, "atRisk": at_risk, "note": note,
    }


def _events() -> list[dict]:
    ev = daily_brief._read_json(global_file("_events.json"))
    if not isinstance(ev, dict):
        return []
    evs = ev.get("events")
    return [e for e in evs if isinstance(e, dict)] if isinstance(evs, list) else []


def _future_sessions_by_slug(now: datetime) -> dict:
    out: dict[str, list[datetime]] = {}
    for e in _events():
        if e.get("eventType") != "session":
            continue
        s = daily_brief._parse(e.get("startAt"))
        slug = e.get("courseSlug")
        if s and slug and s > now:
            out.setdefault(slug, []).append(s)
    return out


def _exams(now: datetime) -> list[tuple[datetime, dict]]:
    rows = []
    for e in _events():
        if e.get("eventType") != "exam":
            continue
        s = daily_brief._parse(e.get("startAt"))
        if s is None or s < now:
            continue
        rows.append((s, e))
    rows.sort(key=lambda x: x[0])
    return rows


def _scan_missing_books() -> list[dict]:
    """Books named in transcripts/self-notes but not uploaded. Best effort."""
    have: set[str] = set()
    for s in [c["slug"] for c in _courses()]:
        bdir = course_dir(s) / "inbox" / "books"
        for p in (bdir.glob("*") if bdir.exists() else []):
            have.add(p.stem.lower())
    pat = re.compile(r'["\u201c]([A-Z][\w:\u2019\' -]{2,60})["\u201d]\s+by\s+([A-Z][\w. -]{2,40})')
    found: dict[str, dict] = {}
    for s in [c["slug"] for c in _courses()]:
        nd = course_dir(s) / "normalized"
        for p in (nd.glob("*.md") if nd.exists() else []):
            if not (p.name.startswith("transcript") or p.name.startswith("self-note")):
                continue
            try:
                txt = p.read_text(errors="replace")
            except OSError:
                continue
            for title, author in pat.findall(txt):
                key = title.lower()
                if key in have or any(key in h or h in key for h in have):
                    continue
                found.setdefault(key, {"title": title.strip(),
                                       "author": author.strip(), "mentionedIn": []})
                if s not in found[key]["mentionedIn"]:
                    found[key]["mentionedIn"].append(s)
    return list(found.values())


def _att_stale() -> bool:
    a, e = global_file("_attendance.json"), global_file("_events.json")
    try:
        return (a.exists() and e.exists()
                and a.stat().st_mtime < e.stat().st_mtime - 3600)
    except OSError:
        return False


def build_overview(now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    today = daily_brief._local_date(now)
    courses = _courses()
    slugs = {c["slug"]: c["name"] for c in courses}

    ev_path = global_file("_events.json")
    scrape_age = (round((time.time() - ev_path.stat().st_mtime) / 3600, 1)
                  if ev_path.exists() else 999.0)

    db = _safe(lambda: daily_brief.build_daily_brief(now=now, within_hours=48), {})
    week = _safe(lambda: daily_brief.build_daily_brief(now=now, within_hours=168), {})

    # --- assessment weights per course ---
    weights: dict[str, list[dict]] = {}
    for s in slugs:
        weights[s] = _safe(lambda s=s: parse_assessment(_outline_body(s)), [])

    def _weight_for(course_slug, title: str):
        for comp in weights.get(course_slug, []):
            if _name_match(comp["name"], title):
                return comp["weightPct"]
        return None

    # --- assignments + risk ---
    assignments = []
    for a, course_label, is_club in _safe(
            lambda: list(daily_brief._iter_assignment_files()), []):
        if not isinstance(a, dict):
            continue
        status = ("submitted" if a.get("mySubmissionStatus") == "submitted"
                  else "draft" if a.get("status") == "draft" else "not-started")
        if status == "submitted":
            continue
        cslug = next((s for s, n in slugs.items() if n == course_label), None)
        w = _weight_for(cslug, a.get("title", "")) if cslug else None
        due = daily_brief._parse(a.get("dueAt"))
        hours = round((due - now).total_seconds() / 3600, 1) if due else None
        urgency = 1.0 if hours is None else max(0.05, min(1.0, 1.0 - hours / (14 * 24)))
        base = (w or 5) / 30.0
        risk = round(min(1.0, base * urgency * (1.0 if status == "not-started" else 0.6)), 3)
        assignments.append({
            "id": a.get("id"), "title": a.get("title") or a.get("id"),
            "course": course_label, "courseSlug": cslug, "weightPct": w,
            "dueAt": due.astimezone().isoformat() if due else None,
            "hoursAway": hours, "status": status, "isClub": is_club,
            "submissionType": a.get("submissionType", "n/a"), "risk": risk,
            "helpCommand": f'/mesa:ares-brain-assignment-help "{_q(course_label)}" "{_q(a.get("title") or "")}"',
        })
    assignments.sort(key=lambda x: -x["risk"])

    # --- grade picture ---
    grade_picture = []
    for s, name in slugs.items():
        comps = weights.get(s, [])
        if not comps:
            continue
        raw = daily_brief._read_json(course_dir(s) / "raw" / "assignments.json")
        subs = ({x.get("title", "").lower() for x in raw
                 if isinstance(x, dict) and x.get("mySubmissionStatus") == "submitted"}
                if isinstance(raw, list) else set())
        rows, ahead = [], 0
        for c in comps:
            done = any(_name_match(c["name"], t) for t in subs) or None
            if done is not True:
                ahead += c["weightPct"]
            rows.append({"name": c["name"], "weightPct": c["weightPct"], "done": done})
        ahead = min(100, ahead)
        pend = [a["title"] for a in assignments if a["courseSlug"] == s][:3]
        grade_picture.append({
            "course": name, "courseSlug": s, "components": rows, "aheadPct": ahead,
            "summary": f"{ahead}% of grade still ahead"
                       + (f": {', '.join(pend)}" if pend else ""),
        })

    # --- brain + gaps ---
    brain_rows, pending_groups, ready_ct = [], [], 0
    for s, name in slugs.items():
        bs = _safe(lambda s=s: brain.brain_status(s), {})
        pend = _safe(lambda s=s: _pending_transcripts(s), {"count": 0, "items": []})
        guide_built = bs.get("guideBuiltAt")
        behind = bs.get("guideSourcesBehind") or 0
        if guide_built is None:
            state = "not-built"
        elif bs.get("indexStale") or behind or pend["count"]:
            state = "stale"
        else:
            state = "ready"
        if state == "ready":
            ready_ct += 1
        reasons = []
        if pend["count"]:
            reasons.append(f"{pend['count']} recordings to transcribe")
        if behind:
            reasons.append(f"guide {behind} sources behind")
        if guide_built is None:
            reasons = ["guide never built"]
        brain_rows.append({
            "course": name, "courseSlug": s, "state": state,
            "corpusBytes": bs.get("corpusBytes"), "sourceCount": bs.get("sourceCount"),
            "indexStale": bs.get("indexStale"), "guideBuiltAt": guide_built,
            "guideSourcesBehind": behind, "pendingTranscripts": pend["count"],
            "reason": " \u00b7 ".join(reasons) or "up to date",
            "buildCommand": f'/mesa:ares-brain-course-brain "{_q(name)}"',
        })
        if pend["count"]:
            pending_groups.append({"course": name, "courseSlug": s, **pend})

    # --- exams ---
    exam_rows = []
    for s_dt, e in _exams(now):
        cslug = e.get("courseSlug")
        exam_courses = [cslug] if cslug else ["all"]
        tp_slugs = list(slugs) if exam_courses == ["all"] else exam_courses
        exam_rows.append({
            "name": e.get("title"), "date": daily_brief._local_date(s_dt),
            "inDays": (s_dt.date() - now.date()).days,
            "courses": exam_courses,
            "courseNames": [slugs.get(c, c) for c in exam_courses],
            "coverageSessions": None,
            "brainReady": (all(b["state"] == "ready" for b in brain_rows) if not cslug
                           else next((b["state"] == "ready" for b in brain_rows
                                      if b["courseSlug"] == cslug), False)),
            "testprepExists": any(
                bool(list((course_dir(x) / "study").glob("testprep-*.md")))
                for x in tp_slugs if (course_dir(x) / "study").exists()),
            "testprepCommand": '/mesa:ares-brain-testprep "<course>"',
        })

    # --- attendance runway ---
    fut = _future_sessions_by_slug(now)
    mid = next((d for d, e in _exams(now)
                if "mid" in (e.get("title") or "").lower()), None)
    end = next((d for d, e in reversed(_exams(now))
                if "end" in (e.get("title") or "").lower()), None)
    last_sess = max((d for ds in fut.values() for d in ds), default=None)
    end = end or last_sess
    att_raw = daily_brief._read_json(global_file("_attendance.json"))
    att_list = att_raw.get("raw", []) if isinstance(att_raw, dict) else []
    by_cid = {c["id"]: c["slug"] for c in courses if c.get("id")}
    attendance = []
    tot_att = tot_conf = 0
    for a in att_list if isinstance(att_list, list) else []:
        try:
            if not isinstance(a, dict):
                continue
            slug = by_cid.get(a.get("courseId"))
            if not slug:
                continue
            f = fut.get(slug, [])
            n_mid = len([d for d in f if mid is None or d <= mid])
            n_end = len([d for d in f if end is None or d <= end])
            rw = attendance_runway(a, n_mid, n_end)
            tot_att += rw["attended"]
            tot_conf += rw["conducted"]
            attendance.append({"course": slugs.get(slug, slug), "courseSlug": slug, **rw})
        except Exception as exc:  # noqa: BLE001 — one bad row must not abort the build
            print(f"overview: attendance row skipped: {exc}", file=sys.stderr)
            continue

    # --- kpis ---
    all_due = week.get("assignmentsDue", []) if isinstance(week, dict) else []
    cp_vals = [a.get("avgCp") for a in att_list
               if isinstance(a, dict) and a.get("avgCp")]
    left_total = sum(a["sessionsLeftToEndterm"] for a in attendance)
    kpis = {
        "dueThisWeek": len([d for d in all_due if not d.get("submitted")]),
        "nextExamInDays": exam_rows[0]["inDays"] if exam_rows else None,
        "nextExamName": exam_rows[0]["name"] if exam_rows else None,
        "cpAvg": round(sum(cp_vals) / len(cp_vals), 1) if cp_vals else None,
        "attendanceNow": round(tot_att / tot_conf * 100) if tot_conf else 0,
        "attendanceBestCase": (round((tot_att + left_total) / (tot_conf + left_total) * 100)
                               if tot_conf else 0),
        "brainReady": ready_ct, "courseCount": len(courses),
    }

    # --- this week ---
    this_week = []
    for a in assignments:
        if a["hoursAway"] is not None and 0 < a["hoursAway"] <= 168:
            this_week.append({
                "when": (a["dueAt"] or "")[:10], "kind": "assignment",
                "title": a["title"], "course": a["course"],
                "courseSlug": a["courseSlug"], "weightPct": a["weightPct"],
                "status": a["status"], "coverage": None,
                "action": {"label": "Start", "type": "copy", "value": a["helpCommand"]},
            })
    for e in exam_rows:
        if 0 <= e["inDays"] <= 7:
            this_week.append({
                "when": e["date"], "kind": "exam", "title": e["name"],
                "course": "Program", "courseSlug": None, "weightPct": None,
                "status": None, "coverage": e["coverageSessions"],
                "action": {"label": "Practice", "type": "copy", "value": e["testprepCommand"]},
            })
    for e in _events():
        if e.get("eventType") != "session":
            continue
        d = daily_brief._parse(e.get("startAt"))
        if d and 0 <= (d.date() - now.date()).days <= 7:
            this_week.append({
                "when": daily_brief._local_date(d), "kind": "class",
                "title": e.get("title") or "Class", "course": e.get("courseName"),
                "courseSlug": e.get("courseSlug"), "weightPct": None, "status": None,
                "coverage": None, "action": None,
            })
    this_week.sort(key=lambda x: (x["when"] or "9999", x["kind"]))

    missing_books = _safe(_scan_missing_books, [])

    return {
        "generatedAt": now.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "date": today, "scrapeAgeHours": scrape_age,
        "term": (db.get("term") if isinstance(db, dict) else None) or "Term 1",
        "kpis": kpis,
        "today": {
            "classes": db.get("classesToday", []) if isinstance(db, dict) else [],
            "dueTodayOrTomorrow": db.get("assignmentsDue", []) if isinstance(db, dict) else [],
            "changed": db.get("changed", {}) if isinstance(db, dict) else {},
        },
        "thisWeek": this_week,
        "assignments": assignments,
        "gradePicture": grade_picture,
        "exams": exam_rows,
        "attendance": attendance, "attendanceMin": _ATT_MIN,
        "brain": brain_rows,
        "chatUnlockAt": _CHAT_UNLOCK,
        "gaps": {
            "pendingTranscripts": pending_groups,
            "missingBooks": missing_books,
            "scrapeStale": scrape_age > 26,
            "attendanceStale": _att_stale(),
        },
    }
