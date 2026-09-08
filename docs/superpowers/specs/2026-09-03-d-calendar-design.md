# Sub-project D — Calendar Sync Design

**Date:** 2026-09-03
**Status:** Draft for review
**Scope:** Sub-project D of the mesa project. Follows A-scrape + A-ingest + B-brain (all shipped, merged to `main` @ `b340eaa`). Delivers objective 1 (assignment due dates → Google Calendar) and objective 3 (24h-before reminders). No daily-job scheduling (that's E).

---

## 1. Context

A-scrape writes `courses/<slug>/raw/assignments.json` (fields incl. `id`, `title`, `courseName`, `dueAt`, `cutoffDate`, `submissionType`, `isGroup`, `mySubmissionStatus`, `status`), `courses/_assignments-unassigned.json` (club/leader assignments with no `courseId`), and `courses/_events.json` (`eventType` ∈ `session`|`event`|`exam`). Current live data: 12 course assignments (10 with `dueAt`, 3 future, 2 unsubmitted) + 3 club assignments with due dates; 6 `exam` events (Mid Term, End Term, vivas).

Sub-project D keeps a dedicated **agent-owned "Mesa Assignments" Google Calendar** in full sync with those deadlines. Each event carries a popup reminder 24h and 2h before (objective 3). `gcloud` CLI is already installed on the build machine.

### What D is NOT

No `launchd` / 6 AM scheduling (E). No LLM call anywhere. No touching the user's primary calendar or any calendar other than "Mesa Assignments". No reading Mesa-synced calendars (`learning@pg27`). No two-way sync — Google is a write target, the LMS is the source of truth.

### Locked cross-cutting decisions (still binding)

- Python sidecar (`scraper/`, `uv` venv, Python 3.12) does deterministic work; a TypeScript MCP tool + a slash command drive it. MCP tools never call an LLM.
- `.env` is a real secret — never read into logs, printed, or committed. **D does not use `.env`** — Google auth is via `gcloud` Application Default Credentials at `~/.config/gcloud/application_default_credentials.json`, and the LMS is not contacted (D reads `courses/` off disk).
- `courses/` is gitignored. `mcp/dist/`, `mcp/node_modules/`, `scraper/.venv/`, raw `scraper/tests/fixtures/*` (except `scrubbed/`) not committed. Committed fixtures: synthetic, no PII.
- `ARES_BRAIN_HOME` overrides the data-tree root; resolve through `paths.py`.
- Every step idempotent + resumable; one API failure never aborts the rest of the run (the `_run_all` per-item try/except pattern).
- JSON writes via `scrape_steps._write_json`. **Note:** B-brain found that `from scrape_steps import ...` transitively imports `mesa_api` → `load_dotenv(.env)`. `calendar_sync.py` must NOT import `scrape_steps` — inline a local `_read_or_none` / `_write_json` (or import from a new leaf module) so the calendar path never loads `.env` or `requests`. Keep `calendar_sync.py` imports to: stdlib, `google.*`, `paths`.

---

## 2. New decisions (this phase)

| Question       | Decision                                                                                                                                                                                                                                                                                                                                                               |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google auth    | `gcloud auth application-default login --scopes=https://www.googleapis.com/auth/calendar` — one-time browser consent, ADC file auto-refreshes. Sidecar loads via `google.auth.default(scopes=[...])`. No GCP OAuth client JSON, no service account. Missing/insufficient creds → a clear `needs-auth` result telling the user the exact `gcloud` command; never crash. |
| Which calendar | A dedicated secondary calendar named **"Mesa Assignments"**. Created on first run if absent; its `calendarId` cached in `courses/_calendar.json`. The primary calendar and all other calendars are never written or read.                                                                                                                                              |
| What syncs     | (a) unsubmitted future assignment `dueAt`; (b) assignment `cutoffDate` when set, ≠ `dueAt`, and future ("LATE CUTOFF"); (c) club/leader assignments (`_assignments-unassigned.json`) with future `dueAt`; (d) future `eventType: exam` events.                                                                                                                         |
| Event shape    | A **30-minute timed event ending at the deadline** (`start = deadline − 30 min`, `end = deadline`). `reminders.overrides = [{method:"popup", minutes:1440}, {method:"popup", minutes:120}]`. Exams also get `{minutes: 10080}` (1 week). `CALENDAR_REMINDERS` env (comma minutes) overrides the assignment reminder list.                                              |
| Reconcile      | Full reconcile — the calendar is entirely agent-managed. Each run: create new, `patch` changed, **delete** events for assignments now submitted / past / removed from the LMS. Events on the calendar with no `_calendar.json` entry are left alone (a hand-added event survives).                                                                                     |
| State          | `courses/_calendar.json` = `{ "calendarId": "...", "syncedAt": "...Z", "events": { "<sourceKey>": { "gcalId": "...", "hash": "..." } } }`.                                                                                                                                                                                                                             |
| Pipeline       | Standalone only: `calendar_sync` MCP tool + `/mesa:ares-brain-calendar-sync` command. Does NOT join `lms_scrape.py all`. Sub-project E decides whether the 6 AM job runs it.                                                                                                                                                                                           |
| Timezone       | Deadlines are stored as UTC instants (`dueAt`/`cutoffDate`/`startAt` are ISO-8601 `...Z`). Events created with `start.dateTime`/`end.dateTime` in UTC + `timeZone: "Asia/Kolkata"` so they render at local time.                                                                                                                                                       |

---

## 3. Repository layout (additions)

```
scraper/
  calendar_sync.py    ADC auth, ensure_calendar, build_desired_events, reconcile
  requirements.txt    + google-api-python-client>=2.100, google-auth>=2.30
  tests/
    fixtures/scrubbed/calendar_corpus/   a small courses/ tree (assignments + events + unassigned)
    test_calendar_sync.py
mcp/src/tools/
  calendar_sync.ts    spawn `calendar-sync`
mcp/test/
  calendar_sync.test.ts
commands/
  calendar-sync.md
courses/
  _calendar.json      (gitignored) sync state
```

New `lms_scrape.py` subcommand: `calendar-sync [--dry-run] [--json]` — reads `courses/` off disk, talks to the Calendar API. No LMS auth (`no mesa_api` import in this branch).

---

## 4. `calendar_sync.py`

### Auth (`_service() -> googleapiclient service | None`)

- `google.auth.default(scopes=["https://www.googleapis.com/auth/calendar"])`. On `DefaultCredentialsError` or a scope error → return `None`.
- Callers that get `None` produce `{"status": "needs-auth", "hint": "run: gcloud auth application-default login --scopes=https://www.googleapis.com/auth/calendar"}` and exit 0.

### `ensure_calendar(service, state) -> str` (calendarId)

- If `state.get("calendarId")` and a `calendarList().get()` on it succeeds → return it.
- Else `calendarList().list()`, find one with `summary == "Mesa Assignments"` → cache + return.
- Else `calendars().insert(body={"summary": "Mesa Assignments", "timeZone": "Asia/Kolkata", "description": "Auto-managed by mesa. Do not hand-edit."})` → cache + return.

### `build_desired_events() -> dict[str, dict]` (pure — no network)

Reads `courses/*/raw/assignments.json`, `courses/_assignments-unassigned.json`, `courses/_events.json`. `now = datetime.now(timezone.utc)`.

For each **assignment** with `dueAt` parseable:

- **due event** (`sourceKey = f"asg:{a['id']}:due"`): only if `mySubmissionStatus != "submitted"` AND `_parse(dueAt) > now` AND `status != "draft"` (published only). Body:
  - `summary`: `f"{title} — due"` (club items: prefix `"[Club] "`)
  - `start/end`: `dueAt − 30min` … `dueAt`, `timeZone: "Asia/Kolkata"`
  - `description`: `f"Course: {courseName or 'Club / Leader'}\nSubmission: {submissionType}\nGroup: {'yes' if isGroup else 'no'}\nSource: mesa"`
  - `reminders`: `{useDefault: False, overrides: [{popup, m} for m in REMINDERS]}` (`REMINDERS` default `[1440, 120]`)
- **cutoff event** (`sourceKey = f"asg:{a['id']}:cutoff"`): only if `cutoffDate` set, `!= dueAt`, `_parse(cutoffDate) > now`, unsubmitted. `summary`: `f"{title} — LATE CUTOFF"`. Same reminders.

For each **exam** event (`_events.json`, `eventType == "exam"`, `_parse(startAt) > now`): `sourceKey = f"exam:{e['id']}"`, `summary = e['title']`, `start = startAt`, `end = endAt or startAt + 90min`, reminders `[10080, 1440, 120]`.

Returns `{sourceKey: {"body": <event body>, "hash": sha256(canonical(body))}}`. `canonical` = `json.dumps({summary,start,end,description,reminders}, sort_keys=True)`.

### `reconcile(service, calendarId, desired, state, dry_run=False) -> dict`

```
result = {created: [], updated: [], deleted: [], unchanged: [], errors: []}
state_events = state.setdefault("events", {})

for key, item in desired.items():
    prev = state_events.get(key)
    try:
        if prev is None:
            if not dry_run:
                ev = service.events().insert(calendarId=calendarId, body=item["body"]).execute()
                state_events[key] = {"gcalId": ev["id"], "hash": item["hash"]}
            result["created"].append(key)
        elif prev["hash"] != item["hash"]:
            if not dry_run:
                service.events().patch(calendarId=calendarId, eventId=prev["gcalId"], body=item["body"]).execute()
                prev["hash"] = item["hash"]
            result["updated"].append(key)
        else:
            result["unchanged"].append(key)
    except Exception as exc:               # noqa: BLE001
        result["errors"].append(f"{key}: {exc}")

for key in [k for k in state_events if k not in desired]:
    try:
        if not dry_run:
            try:
                service.events().delete(calendarId=calendarId, eventId=state_events[key]["gcalId"]).execute()
            except HttpError as he:
                if he.status_code not in (404, 410):
                    raise
        del state_events[key]
        result["deleted"].append(key)
    except Exception as exc:               # noqa: BLE001
        result["errors"].append(f"delete {key}: {exc}")

state["syncedAt"] = _now()
return result
```

`dry_run=True` never calls `.execute()` for a mutation and never edits `state` on disk — it just reports what would happen.

### `run(dry_run=False) -> dict`

`_read_state()` → `service = _service()` → `None` ⇒ `needs-auth` result. Else `ensure_calendar` → `build_desired_events` → `reconcile` → (unless dry-run) `_write_state`. Returns `{status: "ok"|"needs-auth", calendarId, dryRun, ...result}`.

---

## 5. MCP tool & command

- **`calendar_sync({ dryRun? })`** — spawns `lms_scrape.py calendar-sync [--dry-run] --json`, returns the summary. Same handler shape as the other tools (`{ok, summary, stderr.slice(-2000)}` or `{ok:false, error}`). If `google` libs aren't installed → the "sidecar not set up" error, listing the extra `uv pip install` step.
- **`/mesa:ares-brain-calendar-sync`** command → runs `calendar_sync` (no args, or `dryRun: true` if the user says "preview"/"dry run"). Reports: calendar name, created/updated/deleted/unchanged counts, any `errors` verbatim, and if `status == "needs-auth"` the exact `gcloud` command.

Neither joins `all`.

---

## 6. Testing

- **`build_desired_events`** (pure, no network): a fixture `calendar_corpus/` with — one submitted assignment (excluded), one unsubmitted future (due event), one with a distinct future `cutoffDate` (due + cutoff events), one past-due (excluded), one draft (excluded), one club assignment (due event, `[Club]` prefix), one future exam, one past exam (excluded). Assert the exact `sourceKey` set, the summaries, the 30-min windows, the reminder lists (exam has 10080).
- **`canonical`/`hash`**: reordering keys in a body → same hash; changing the due time → different hash.
- **`reconcile`** with a fake `service` (a stub object recording `.events().insert/patch/delete` calls):
  - empty state + 3 desired → 3 `insert`, state has 3 entries.
  - state hash matches → `unchanged`, no API call.
  - state hash differs → `patch`, state hash updated.
  - state key not in desired → `delete`, state entry removed.
  - `delete` raising `HttpError(404)` → counted as deleted, no error.
  - `insert` raising a generic exception → in `errors`, other keys still processed.
  - `dry_run=True` → zero `.execute()` mutations, state file unchanged on disk.
- **`_service` None path**: monkeypatch `google.auth.default` to raise `DefaultCredentialsError` → `run()` returns `{status: "needs-auth"}`, exit 0, no state write.
- **MCP tool**: temp `ARES_BRAIN_HOME`, stub the python spawn, assert argv (`--dry-run` toggles) + summary parsing. Missing `google` lib → sidecar-missing error.
- **Live run** (final task): the user runs the `gcloud` command; then `/mesa:ares-brain-calendar-sync --dry-run` (inspect the plan), then a real `/mesa:ares-brain-calendar-sync`; verify the "Mesa Assignments" calendar appears with the right events + reminders; submit/undo a test assignment state and re-sync to see update/delete; record in `docs/lms-api.md`.

---

## 7. Build order (one spec, staged plan)

1. `calendar_sync.py` — deps, ADC `_service`, `ensure_calendar`, `build_desired_events` (pure) + fixture + tests.
2. `canonical`/`hash` + `reconcile` + `_calendar.json` state + `run` + `--dry-run` + tests (fake service).
3. `calendar-sync` subcommand + `calendar_sync` MCP tool + `/mesa:ares-brain-calendar-sync` command + README + live run + findings.

---

## 8. Open items

1. **Calendar deletion / reset:** no "unsync everything" command in D. If the user wants to wipe the calendar, they delete it in Google Calendar and remove `courses/_calendar.json`; the next sync recreates it. A `/mesa:ares-brain-calendar-sync --reset` could be added later.
2. **Multiple machines:** `_calendar.json` is per-checkout. Running sync from a second machine with its own empty state would re-create duplicate events (it can't see the first machine's `gcalId`s). D assumes one machine. If that changes, key events by an extended property (`extendedProperties.private.sourceKey`) and reconcile by listing the calendar instead of trusting local state.
3. **Reminder noise:** 2h popups on every assignment may be a lot near a deadline cluster. `CALENDAR_REMINDERS` lets the user dial it to `1440` only. Default stays `1440,120`.
4. **`gcloud` ADC scope caveat:** `gcloud auth application-default login` without `--scopes` grants only `cloud-platform`; the Calendar API then 403s. The `needs-auth` hint must include the exact `--scopes` flag, and the live-run task verifies a scoped login works.
