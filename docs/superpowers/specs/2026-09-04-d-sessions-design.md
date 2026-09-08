# D-sessions — class schedule + program events on the calendar

**Date:** 2026-09-04
**Status:** Approved
**Scope:** Targeted revision of sub-project D. `build_desired_events` currently emits only
assignment + exam events (7 total). Add `session` (class) and `event` (orientation, guest
talks, etc.) entries from the scraped `courses/_events.json`. `calendar_sync.py` only.

## Why

The scraped `courses/_events.json` `events[]` has 145 `session` + 110 `event` + 6 `exam`
entries. `build_desired_events` filters to `eventType == "exam"` only, so the 3–4 daily
Mon–Sat classes never reach the Mesa calendar. User wants the full class schedule synced.

## Locked decisions (still binding from D / D-oauth)

- `calendar_sync.py` imports stay: stdlib + `from paths import ...` at module top; `google.*`
  lazy inside functions. No `scrape_steps`. `test_calendar_sync_import_isolation` stays green.
- `.env` never read/printed.
- `run()` / `reconcile` / `ensure_calendar` / `_service` / `do_auth` / the MCP tool / the
  `/mesa:ares-brain-calendar-sync` command / `courses/_calendar.json` state shape — UNCHANGED.
- Every reconcile item is per-item try/except; one bad event never aborts the run.

## Decisions (this revision)

| Question          | Decision                                                                                                                                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Event types added | `session` AND `event`. Exams + assignments unchanged.                                                                                                                                                                      |
| Time window       | Future only (`start > now`). Past sessions excluded → reconcile deletes them from the calendar as days pass.                                                                                                               |
| Reminders         | Sessions + events use `_reminders()` (the 24h+2h assignment set). New env `CALENDAR_SESSION_REMINDERS` overrides ONLY these: unset → same as `CALENDAR_REMINDERS`; set-empty → no reminders; `"15"` → single 15-min popup. |
| Location          | `e["room"]` → gcal `location` field. `meetingLink` + `instructorName` → into the description.                                                                                                                              |
| sourceKey         | `f"{eventType}:{e['id']}"` → `session:<id>` / `event:<id>`. No collision with `exam:` / `asg:`.                                                                                                                            |
| Title             | `e["title"]` verbatim (session titles already carry the professor name).                                                                                                                                                   |

## `calendar_sync.py` changes

1. **`_session_reminders() -> list[int]`** — new. `CALENDAR_SESSION_REMINDERS` unset → `_reminders()`;
   set-and-blank → `[]`; CSV of ints → parsed; parse error → `_reminders()`.
2. **`_event_body(...)`** — new optional kwarg `location: str | None = None`; when truthy, add
   `body["location"] = location`.
3. **`canonical(body)`** — keep-set gains `"location"`, read via `body.get(k)` (absent → `None`).
   NOTE: this changes the hash of the 7 existing assignment/exam events (they gain a
   `"location": null` slot) → one-time `updated` on them at the next sync. Harmless; reconcile
   patches in place.
4. **`build_desired_events`** — after the exam loop, iterate the same `ev.get("events", [])`:
   - skip unless `eventType in ("session", "event")` with a parseable future `startAt`.
   - `end = _parse(endAt) or start + timedelta(minutes=90)`.
   - description lines: `Course: <courseName|courseLabel|"Program">`, then `Instructor: …`,
     `Link: …`, `Room: …` (each only when the field is truthy), then `Type: <eventType>`,
     `Source: mesa`.
   - `body = _event_body(title, start, desc, _session_reminders(), end=end, location=room or None)`.
   - `out[f"{eventType}:{e['id']}"] = {"body": body, "hash": _hash(body)}`.
5. **Module docstring line 1** — "assignment/exam deadlines" → "assignment / exam / class schedule".

## Reconcile / state

Unchanged. Each run: past sessions leave `desired` → reconcile issues `delete` + drops the
state entry. Calendar events with no state entry (hand-adds) still untouched.

## Volume

First real sync after this: ~96 sessions + ~48 events + 5 exams + 2 assignments ≈ **151 creates**
(+ ~7 one-time updates from the `canonical` change). Per-item try/except already present.
Later runs: deltas only.

## Testing (`scraper/tests/test_calendar_sync.py`)

- `build_desired_events` with a fixture `courses/_events.json`: a future `session` (room +
  meetingLink + instructorName set), a future generic `event`, a PAST `session`, a `session`
  with a garbage `startAt` → assert `session:<id>` and `event:<id>` keys present; past + bad-date
  absent; the session body has `location` == room and its description contains the link + instructor.
- `_event_body(..., location="X")` → `body["location"] == "X"`; `canonical` output contains it.
  `_event_body(...)` with no location → no `"location"` key.
- `CALENDAR_SESSION_REMINDERS` unset → session reminders == `_reminders()`; `"15"` → `[15]`;
  `""` → `[]`.
- Existing exam / assignment / reconcile / `ensure_calendar` / import-isolation tests unchanged
  and green.

## Live run

`calendar-sync --dry-run --json` (expect `created` ~150), then `calendar-sync`, then again
(expect all `unchanged` bar 0). Spot-check one class in Google Calendar: IST time correct,
room as location, professor in the title, 24h/2h popups. Record in `docs/lms-api.md`.

## Build order

One task, subagent-driven, TDD.
