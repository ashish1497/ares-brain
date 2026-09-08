# Mesa Students LMS — API findings

Reverse-engineered from the LMS frontend and confirmed by a live discovery spike
on **2026-09-01**. Update as the scraper evolves.

- **API base:** `https://api-students.mesaschool.co.in/api/v1`
- **Frontend base:** `https://students.mesaschool.co.in`
- Every response is wrapped in `{ "data": ... }`.
- All routes return `401 UNAUTHENTICATED` without a valid bearer token, including
  nonexistent routes — unauthenticated probing tells you nothing.

---

## Auth

### Refresh flow (confirmed)

```
POST https://students.mesaschool.co.in/api/auth/refresh
Headers:
  Content-Type: application/json          # REQUIRED — omitting it gives 415
  Cookie: refresh_token=<token>
Body: {}
```

Response:

```json
{ "data": { "accessToken": "<jwt>", "user": { ...profile... } } }
```

- **Access token lifetime: ~15 minutes** (`exp - iat = 900`). Payload:
  `{ account_type, program_scope, sub, iat, exp }`.
- **The refresh token ROTATES on every successful call.** The response sends:
  - three `Set-Cookie: refresh_token=; Max-Age=0` lines clearing the old value on
    paths `/`, `/api`, `/api/v1/auth`
  - one `Set-Cookie: refresh_token=<NEW VALUE>; Path=/api/v1/auth; HttpOnly; Secure`
  - The scraper MUST parse the new value from `Set-Cookie` and persist it
    (atomically) before doing anything else. A spent token → the response has no
    `data` key / `UNAUTHENTICATED`, and that identity is locked out until the
    user pastes a fresh one.
- Refresh-token payload: `{ tid, sub, iat, exp }`, `exp - iat ≈ 30 days`. `tid`
  changes on every rotation; `sub` is the stable user id.

### API calls

```
GET <base>/<path>
Headers:
  Authorization: Bearer <accessToken>
  Accept: application/json
```

---

## Endpoints

### `GET /users/me`

`data.user`: `{ id, email, accountType, status, firstName, lastName, phone,
bloodGroup, avatarUrl, enrollmentNo, mustChangePassword, createdAt, roles[] }`.
Use to confirm the token works. `email` is like `ashish_bajaj@pg27.mesaschool.co`
(the `pg27` matches the `gcalAccount` on events).

### `GET /curriculum/courses?termId=<termId>`

`data.courses[]`: `{ id, termId, title, shortName, code, description, courseType
("core"|...), classType ("online"|...), instructorName, coverImageUrl, visible,
startDate, endDate, sequence, createdAt, updatedAt }`.

- **`termId` matters.** The value from the community-page URL
  (`7431dfa8-b658-4849-b148-c89b68027f4a`) is a _pre-program_ term — it returns
  only one course ("Start Strong").
- **The live term** is `17a4f404-0fde-4db8-9599-3a20d3199416` ("Term 1"), 16
  courses. **Do not hardcode it** — read the current term from
  `/attendance/student/summary` (below), whose rows carry `termId` + `termName`.
- Mesa has 4 terms total.
- No working `terms` list endpoint found (`/curriculum/terms` needs a
  `programId` we get 403 on; `/terms` 404).

### `GET /attendance/student/summary`

`data` is an **array** (not an object): one row per course:
`{ courseId, courseName, termId, termName, attended, total, percentage, avgCp }`.

- **`total` = sessions conducted so far** in that course → this is `sessionIndex`.
- `attended` = the student's personal attendance (not used for session detection).
- `avgCp` = average class-participation score.
- The row's `termId`/`termName` is the authoritative "current term" signal.

### `GET /assignments/my`

`data.assignments[]` (spike: 15 items). Per item:
`{ id, courseId, leaderId, leaderAudience, courseTitle, topicId, title,
description, instructions (HTML), submissionType ("file"|"any"|...), isGroup,
groupSize, maxMarks, allowSubmissionsFrom, dueAt, cutoffDate, allowLate,
sendNotification, status ("published"|...), publishedAt, createdAt, maxAttempts,
requireAllMembers, materials[], restrictions[], mySubmissionStatus
("submitted"|null) }`.

- **`dueAt`** (ISO UTC) is the due date. **`cutoffDate`** is the hard late cutoff.
  Spike: 13/15 had `dueAt`.
- **`courseId` is often `null`** (spike: 12/15 set). Null ones are club/"leader"
  assignments (`leaderId` set, `leaderAudience: "opted_in"`); they carry a
  `topicId` instead. Map via topic → course when possible, else bucket under a
  synthetic "Leader / Clubs" course.
- **`mySubmissionStatus`**: `"submitted"` or `null`. Calendar sync should include
  only items with `dueAt` in the future AND `mySubmissionStatus != "submitted"`.

### `GET /assignments?courseId=<id>&status=published`

`data.assignments[]`, same item shape but `courseTitle` populated (e.g.
`"Business Frameworks with Pranjal Bangani"`) and `courseId` set. The per-course
view; use it to fill gaps in `/assignments/my` and to catch assignments not yet
in "my work".

### `GET /events/my?from=<ISO>&to=<ISO>`

`data.events[]` (large — spike window of 1 month = 119 events, 151 KB). Per item:
`{ id, title, description, eventType, status ("scheduled"|...), programId,
programName, termId, termName, courseId, sectionIds[], sectionNames[],
courseName, courseLabel, gcalEventId, gcalEventLink, gcalAccount, gcalSyncStatus,
gcalSyncError, gcalSyncedAt, gcalAttendees[], gcalAttendeesAt, courseCoverUrl,
startAt (ISO UTC), endAt (ISO UTC), timezone ("Asia/Kolkata"), instructorName }`.

- **`eventType`**: `session` (85 — actual classes), `event` (33 — workshops,
  "building time", student-experience blocks), `exam` (1 — "Mid Term Exams").
- **No assignment-deadline events.** Deadlines come only from `/assignments/my`.
- `session` events are already synced to a Mesa-run Google Calendar
  (`gcalEventId`, `gcalEventLink`, `gcalAccount: "PGP_27"`,
  `gcalSyncStatus: "synced"`). Our calendar work (Sub-project D) is a _separate_
  "Mesa Assignments" calendar and should not fight this one.
- `courseId` can be `null` for program-wide events (e.g. "Ganesh Chaturthi",
  "Study Block").
- `from`/`to` are required query params, URL-encoded ISO.

### `GET /announcements?page=<n>&limit=<n>`

`data.announcements[]`: `{ id, audience ("program"|"course"|...), courseId,
programId, leaderId, sectionId, sectionIds[], sectionNames[], programName,
courseName, sectionName, authorName, authorAvatarUrl, title, body (HTML),
... , publishedAt/createdAt }`. Paginated.

### `GET /curriculum/topics?courseId=<id>`

`data.topics[]`: `{ id, courseId, title, type, sequence }`.

Every course has the **same six topic buckets**, distinguished by `type`:
`outline`, `prereads`, `assignments`, `resources`, `recordings`, `announcements`.
The scraper resolves these per course, then reads materials/recordings from each.

### `GET /content/topics/{topicId}/materials`

`data.materials[]`: `{ id, topicId, title, category, kind ("text"|"file"|"link"),
content (HTML, when kind=text), fileName, fileType, sizeBytes, url (usually
null), allowDownload, isPublished, session (int|null), resourceSessionId,
createdAt, updatedAt }`.

- `category` mirrors the topic type (`outline`, `preread`, `resource`, ...).
- **`kind: "text"`** → readable HTML is in `content`. The **outline** is a
  `text` material whose content is just a **Google Sheets link** — the real
  class-by-class outline lives in that sheet, not the API. (Open question: do we
  read the sheet? see design §10.)
- **`kind: "file"`** → `url` is `null`; fetch the download URL separately via
  `GET /content/materials/{materialId}/signed-url` (per the frontend route map;
  not re-confirmed in this spike). Respect `allowDownload`.
- **`kind: "link"`** → an external URL (e.g. a workbook link), carried in the
  `url` field. Not downloadable; the scraper preserves `url` and leaves
  `localPath: null`.
- **`session`** ties a material to a session number (present on prereads/outline,
  null on ad-hoc resources). `resourceSessionId` groups materials by session.

### `GET /content/topics/{topicId}/recordings`

`data.recordings[]`: `{ id, topicId, title ("Session 1"), videoUrl, provider
("youtube"), embedUrl, thumbnailUrl, durationSec, recordedOn ("YYYY-MM-DD"),
isPublished, createdAt, updatedAt }`.

- **All recordings are YouTube links** (`provider: "youtube"`,
  `videoUrl: https://www.youtube.com/live/<id>...`). None are downloadable files.
- → transcription path is: `yt-dlp` extract audio → `faster-whisper`. There is no
  "downloadable file" branch for recordings in practice.

### `GET /banners/student`

`data.banners[]`: promo banners with signed image URLs. Not useful — skip.

---

## Implications for the scraper (Sub-project A)

1. **Term discovery:** call `/attendance/student/summary` first; take the
   `termId` from its rows as the current term; pass that to
   `/curriculum/courses`. Keep `config/mesa-api.json` `termId` only as an
   optional override.
2. **Course list** comes from `/curriculum/courses?termId=` ∪ the courses named
   in the attendance summary (belt and braces).
3. **Per course:** `/curriculum/topics?courseId=` → for each topic, `materials`
   (or `recordings` for the recordings topic).
4. **Assignments:** merge `/assignments/my` with per-course
   `/assignments?courseId=&status=published`; dedupe on `id`; resolve `courseId`
   via `topicId` where null.
5. **Events:** one `/events/my` call with a wide window (± 60 days), stored whole.
6. **Signed URLs:** file materials need a second call per material; cache the
   downloaded file, not the URL (URLs are time-limited).
7. **Token:** refresh once at the start of a run, persist the rotated token
   immediately, reuse the access token for ~14 minutes, re-refresh if a call
   returns 401 mid-run.

---

## Live scrape — 2026-09-01

First full `lms_scrape.py all` run. Results:

- Term 1, 16 courses, `errors: []`.
- 3 assignments unresolved to a course (`_assignments-unassigned.json`) — all leader/club items with null courseId and a topicId not in any scraped course's topic list.
- 261 events in a ±60-day window: 145 `session`, 110 `event`, 6 `exam`. 144 resolved to a course slug.
- Recordings found for 9 of 16 courses (2–6 each), all YouTube.
- Materials: `kind` values seen = `file`, `text`, `link`. `link` materials carry their target in `url` (added to the manifest after this run).
- Signed-url download worked for every `kind:file` + `allowDownload` material (55 files, 0 fileErrors).
- Attendance `total` (sessions conducted) ranged 1–5 across courses.
- Token rotation worked cleanly on every run; the rotated value persisted to `.env` each time.

---

## A-ingest live run — 2026-09-02

First `lms_scrape.py ingest` + `transcribe` run against the 2026-09-01 scrape
(16 courses, ~90 MB, 44 downloaded files).

**`ingest`** — `errors: []`, wall-clock ~10 s for the full 16 courses. 239
normalized `.md` files written (0 orphans, 0 skips on a fresh manifest):

| type         | count |
| ------------ | ----- |
| session      | 132   |
| material     | 77    |
| assignment   | 12    |
| outline      | 9     |
| announcement | 9     |

Per-course normalized counts: ai-and-its-application 21, ai-workshops 4,
build-your-own-business 11, business-frameworks-with-pranjal-bangani 12,
business-reader-with-suprad 14, career-readiness 1,
crafting-marketing-strategies-with-prof-siddarth-menon 20,
data-driven-decision-making-with-prof-vinay-sharma 36,
entrepreneurship-101-with-abhishek 16, fundamentals-of-finance-with-prof-narahari
21, mesa-start-up-lab 7, orientation-week 3, power-of-communication 35,
startup-leader 7, the-art-of-selling-with-prof-rishabh-ladha 31, workshops 0.

- **Outline sheet:** fetched cleanly for all 9 courses that have an `outline`
  topic — no 403s. The Google Sheet CSV export renders as a raw markdown table
  (multi-column, no column-name assumptions), which is readable but noisy;
  acceptable for the corpus.
- **Bug found + fixed (the point of the live run):** `_material_body` read
  `kind:file` materials from `course_dir(slug) / localPath`, but `localPath` in
  `materials.json` is relative to `raw/` (`files/<id>.pdf`). All 44 file
  materials normalized to `(unextractable file: No such file or directory)`.
  Fixed to `raw_dir(slug) / localPath`; added a regression test
  (`test_normalize_material_file_kind_reads_from_raw_files`). Re-ran: 0
  unextractable, pdf/docx/pptx/xlsx bodies extract correctly.
- Manifest (`normalized/_ingest.json`, `ingestedAt` + per-source input hashes)
  works: an immediate re-run skipped all 239 with 0 rewrites.

**`transcribe --course business-frameworks-with-pranjal-bangani`** — 1 recording
(`Session 1`, YouTube live link `youtube.com/live/3_FxQk86qLo`).

- Result: `{"transcribed": ["498e625a-…"], "skipped": [], "failed": []}` — 0
  needs-manual. `yt-dlp -x` pulled the audio with no throttling / 403.
- Wall-clock ~19 min for the one recording (faster-whisper `small`, int8, auto
  device on Apple Silicon; includes one-time `small` model download on the first
  attempt). A prior run with `timeout 900` was killed mid-whisper — budget
  `timeout 3000` / background for a full session recording.
- Output `transcripts/498e625a-….md`: 1208 lines, correct frontmatter
  (`type: transcript`, `source: raw/recordings.json#<id>`, title/course/recordedOn).
  Body lines are `[hh:mm:ss] text`. Transcript quality is good — proper nouns
  land ("Pranjal", "Swiggy", "BCG", "Bain", "Arsenal"), sentences are coherent,
  timestamps track the audio.
- Re-run skips via `dest.exists()` (the id-keyed cache).

**Wall-clock:** full `ingest` ~10 s (16 courses); `transcribe` ~19 min for one
recording. Do NOT run `transcribe` for all 16 courses in one pass.

**Design change (after measuring ~19 min/recording):** `lms_scrape.py all` no
longer runs `step_transcribe` — the `all` pipeline is scrape steps → `ingest`
only. Transcription is available solely via the standalone `transcribe`
subcommand / `transcribe` MCP tool / `/mesa:ares-brain-course-ingest` command. `ingest` still
normalizes any transcript `.md` files already on disk under `transcripts/`.

## B (brain) live run — 2026-09-03

`brain-index` over all 16 real courses (771 KB corpus): completes in seconds,
first pass builds every index, second pass reports `skipped: true` for all.
`all` now runs `ensure_course_md` + `build_index` per course after `ingest`;
summary gains `brainsIndexed`.

Per-course `sourceCount` / `corpusBytes` (FTS body bytes, frontmatter stripped):

| course                                                 | docs | corpusBytes | embeddingsRecommended |
| ------------------------------------------------------ | ---- | ----------- | --------------------- |
| business-frameworks-with-pranjal-bangani               | 15   | 176,661     | **yes**               |
| power-of-communication                                 | 36   | 129,976     | no                    |
| data-driven-decision-making-with-prof-vinay-sharma     | 37   | 120,706     | no                    |
| the-art-of-selling-with-prof-rishabh-ladha             | 32   | 85,909      | no                    |
| crafting-marketing-strategies-with-prof-siddarth-menon | 21   | 79,849      | no                    |
| business-reader-with-suprad                            | 15   | 29,147      | no                    |
| ai-workshops                                           | 4    | 27,284      | no                    |
| entrepreneurship-101-with-abhishek                     | 17   | 22,590      | no                    |
| ai-and-its-application                                 | 22   | 17,931      | no                    |
| fundamentals-of-finance-with-prof-narahari             | 22   | 17,342      | no                    |
| build-your-own-business                                | 12   | 15,016      | no                    |
| orientation-week                                       | 3    | 3,193       | no                    |
| mesa-start-up-lab                                      | 7    | 1,097       | no                    |
| startup-leader                                         | 7    | 964         | no                    |
| career-readiness                                       | 1    | 128         | no                    |
| workshops                                              | 0    | 0           | no                    |

Only `business-frameworks` crosses the 150 KB embeddings threshold; two more are
close. `brain-query --params '{"text":"unit economics"}'` (no course) spans all
courses, bm25-ranked, returns sensible cross-course hits (Business Frameworks
S1, Finance S3, BYOB unit-economics slide).

**next-session** for 4 courses — every one resolved via `source: "events"`
(Mesa's calendar has real future `session` events for all active courses):

| course                                             | sessionsConducted | nextIndex | startAt           | source |
| -------------------------------------------------- | ----------------- | --------- | ----------------- | ------ |
| business-frameworks-with-pranjal-bangani           | 0                 | 1         | 2026-09-11T06:00Z | events |
| fundamentals-of-finance-with-prof-narahari         | 5                 | 6         | 2026-09-03T06:00Z | events |
| the-art-of-selling-with-prof-rishabh-ladha         | 4                 | 5         | 2026-09-04T10:30Z | events |
| data-driven-decision-making-with-prof-vinay-sharma | 4                 | 5         | 2026-09-10T10:30Z | events |

**`parse_outline` on real Mesa outlines: unstructured.** Every course's
`outline-outline.md` is the "Mesa Outline Template" doc (Course Title / Objective
/ Faculty LinkedIn / ... sections), not a session|date|topic grid. The first
markdown table in the doc is the title/objective block, so `parse_outline`
correctly returns `structured: false`. The per-session schedule, where it exists,
is lower in the doc in prose/other tables — the current first-table heuristic
does not reach it. Not a blocker: `next_session` falls back to outline only when
there is no calendar event, and all active courses have events.
`outlineRow` and `prereadPaths` therefore come back `null`/`[]` in the live run —
also because real `normalized/*.md` docs carry no `session:` frontmatter, so
session-scoped pre-read lookup has nothing to match. Pre-read resolution for real
courses will need either session tagging at ingest time or a smarter outline
parser (future work).

No crashes, no wrong next-session results. `brain-status` fields all populate
correctly against the real corpus. GUIDE.md quality and the `/mesa:ares-brain-course-brain` /
`/mesa:ares-brain-course-brief` / `/mesa:ares-brain-week-ahead` skill flows need a human Claude Code session to
verify (skills cannot be executed from a subagent).

## D (calendar) live run — 2026-09-03

`calendar-sync --dry-run --json` was run against the real `courses/` tree with the
existing ADC file at `~/.config/gcloud/application_default_credentials.json`.

Verbatim output:

```json
{
  "status": "ok",
  "dryRun": true,
  "calendarId": null,
  "created": 0,
  "updated": 0,
  "deleted": 0,
  "unchanged": 0,
  "errors": [
    "ensure_calendar: ('invalid_grant: Bad Request', {'error': 'invalid_grant', 'error_description': 'Bad Request'})"
  ]
}
```

- **ADC-with-scopes did NOT work.** The ADC file present was created by a plain
  `gcloud auth application-default login` and its refresh token is
  rejected (`invalid_grant`) — it lacks the calendar scope and/or has expired.
  `_service()` returned a client (creds file exists), so the failure surfaced at
  the first API call (`calendars().insert` inside `ensure_calendar`) and was
  caught into `errors[]` rather than the `needs-auth` short-circuit.
- **Not a code bug.** No crash, correct argv, valid JSON, exit 0, error isolated.
- **Human step required** before a real sync:
  `gcloud auth application-default login --scopes=https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/calendar`
  then re-run `calendar-sync --dry-run` to get the actual create/update/delete plan,
  and `/mesa:ares-brain-calendar-sync` (non-dry-run) with the user watching to write the calendar.
- Idempotency check, reminder-time verification, and `calendars().insert`
  propagation-delay observations are pending that scoped login.

## C (task commands) live run — 2026-09-03

- **CLI parts exercised** (skill-driven `/mesa:ares-brain-ask` `/mesa:ares-brain-assignment-help` `/mesa:ares-brain-testprep`
  `/mesa:ares-brain-book-summary` require a human Claude Code session and were not run here):
  `ingest --course <slug>`, `brain-index --course <slug>`,
  `brain-query --params '{"course":"<slug>","type":"book-summary"}'`.
- **`_normalize_study_book_summaries` round-trip** (course
  `business-frameworks-with-pranjal-bangani`):
  1. Hand-created `courses/<slug>/study/book-test-summary.md`
     (`type: book-summary`, `title: Book Test Summary`).
  2. `ingest` → `{"normalized": 1, ...}`, produced
     `normalized/mesa:ares-brain-book-summary-book-test-summary.md` (title from frontmatter →
     stable filename).
  3. `brain-index` → `indexed: 16`; `brain-query type:book-summary` returned the
     doc with its snippet.
  4. Deleted the study file, re-ran `ingest` → `{"orphansDeleted": 1}`, the
     normalized doc was removed; `brain-index` → `indexed: 15`; `brain-query
type:book-summary` → `[]`.
  5. Test files cleaned up (all under gitignored `courses/`).
- Skill wording: kept the brief's SKILL.md verbatim; no tightening needed.

## D-oauth live run — DONE (2026-09-04)

User swapped in a Desktop-type `client_secret.json`, ran `calendar-auth` — browser
consent succeeded, `token.json` written (mode 600, 727 bytes, authorized-user JSON).
`run_local_server(port=0)` worked; no `run_console()` fallback needed.

Live `calendar-sync` results (`ARES_BRAIN_HOME` = repo root):

- `--dry-run`: `status:ok`, calendar auto-created, `created:7`, 0 errors.
- 1st real run: `created:7`, `errors:[]`. `calendarId` =
  `c_36ceaabbda013fcb0a62de14ea992e835ac0c6f87858bec66d8d36716d1f0c80@group.calendar.google.com`.
- 2nd real run: `created:0 unchanged:7` — idempotent, zero API mutations. ✓

7 events = current unsubmitted future assignments + future exams across the 16
courses. Reminder/IST-time eyeball check left to the user in Google Calendar
("Mesa Assignments" calendar, 24h + 2h popup overrides).

## D-sessions live run — DONE (2026-09-04)

Data from the same-day full scrape (`courses/_events.json`, 261 events).

- `calendar-sync --dry-run`: `created:142 updated:7 deleted:0 errors:[]`.
  The 7 updates = existing assignment/exam events picking up the new
  `location` slot in the canonical hash (one-time, expected).
- 1st real run: `created:142 updated:7`, 0 errors.
- 2nd real run: `unchanged:149`, everything else 0 — hash converges, no
  perpetual-diff loop.

Calendar state now: 94 sessions + 48 program events + 5 exams + 2 assignments
= 149 events. Spot-checked one session: summary `"AI and its Application with
Divij"`, location `"Delta Classroom"`, description carries Course / Instructor /
Room / Type / Source, reminders `[120, 1440]`. `startAt` from the API is UTC
(`08:30:00Z`) → written as `08:30:00+00:00` with `timeZone: Asia/Kolkata`
(displays 14:00 IST) — same pattern the exam/assignment events already use.
Most sessions have no `meetingLink` so no Link line.

## E daily job — live run 2026-09-04

- `lms_scrape.py daily-brief --json` against the real corpus (post same-day scrape):
  4 classes today (Power of Communication, AI ×2, Art of Selling — all Delta Classroom,
  correct instructors), `assignmentsDue: []` (nothing in 72h), `changed` populated for
  13 courses (first full sync — the baseline, not genuine deltas), `scrapeStale: false`.
  Title-parsed pre-read matching worked: Art of Selling's session-5 class resolved
  `normalized/material-session-5-pre-read.md`; the other courses' materials have no
  "Session N" in their titles so `prereadPaths: []` (known B-brain limitation).
- Digest (`daily/2026-09-04.md`) + `osascript` notification hand-generated from that
  data (skill steps 3-5) — format confirmed, notification fired.
- **NOT yet verified end-to-end:** `/mesa:ares-brain-course-daily` via `claude -p` and the launchd job.
  The `mesa` plugin is not installed on this machine, so `claude -p
/mesa:ares-brain-course-daily` can't resolve the skill/tools yet. User must `/plugin install <repo>`
  (after `cd mcp && npm install && npm run build`), then `/mesa:ares-brain-daily-setup`, then
  `launchctl start co.mesa.ares-brain.daily` and check `daily/_launchd.log` for any
  tool-permission prompt — widen `--allowedTools` in the plist if so and record the
  final string here.

## E launchd job — install notes (2026-09-04)

Plugin install (no `/plugin` TUI needed — run in a shell):

- added `.claude-plugin/marketplace.json` (local single-plugin marketplace).
- `cd mcp && npm install && npm run build`
- from the repo's PARENT dir: `claude plugin marketplace add ./ares-brain`
- `claude plugin install mesa@mesa-local`
- it's a CACHE COPY, not a live link. After a repo change:
  `claude plugin uninstall mesa@mesa-local && claude plugin marketplace update mesa-local && claude plugin install mesa@mesa-local`

launchd `ProgramArguments` corrections found by live testing:

- `-p` arg must be the NAMESPACED command: `/mesa:ares-brain-course-daily`
  (bare `/mesa:ares-brain-course-daily` → "Unknown skill: course-daily").
- MCP tool allowlist entries are `mcp__plugin_mesa_mesa__<tool>`
  (NOT `mcp__mesa__<tool>`).
- add `--permission-mode acceptEdits`.
- load with `launchctl bootstrap gui/$(id -u) <plist>` / `bootout` (not deprecated `load`).

STILL OPEN — headless auth: the launchd job runs `/opt/homebrew/bin/claude` (Homebrew
CLI, v2.1.98), a SEPARATE install from the desktop app (v2.1.260) and NOT logged in →
job exits 1 with "Not logged in · Please run /login". No `~/.claude/.credentials.json`,
no keychain entry. Fix: run `claude setup-token` once in Terminal.app (long-lived token
for automation, needs the Claude subscription). Then re-kick
`launchctl kickstart -k gui/$(id -u)/co.mesa.ares-brain.daily`.

Verified working by hand this session (plugin loaded in an interactive Claude Code):
`/mesa:ares-brain-course-daily` → scrape (17 courses, 0 err) → calendar-sync
(deleted 1 past class, unchanged 148) → `daily_brief` tool → `daily/2026-09-04.md`
(4 classes, Selling session-5 pre-read matched, nothing due 72h) → notification. All 5
skill steps good end to end.

## F dashboard — live run 2026-09-08

`npm run --workspace ares-dashboard start` on `127.0.0.1:4319`, verified in a browser:

- UI renders (dark mode, Tabler icons, course picker populated from `_index.json`,
  4 cards, job-log strip, "Chat — phase 2").
- `POST /api/jobs {kind:"ingest",course:"ai-and-its-application"}` → 202, job spawned
  `lms_scrape.py ingest --course …`, stdout streamed over SSE to `event: end`,
  state → `status:"done" exitCode:0` (22 skipped, 0 errors).
- Guards: 2nd job while running → **409**; `Host: evil.com` → **403**.
- Page reload mid/after-job → poll picks up state, buttons re-enable (the T3 freeze fix).

**Not verified — `transcribe-url` end to end.** yt-dlp cannot reach YouTube from this
machine's network (every attempt, incl. the always-available "Me at the zoo" video,
returns `{"ok": false, "error": "could not pull audio from the url"}`). The job
runner + SSE + `transcribe_url` error handling all behave correctly; only the actual
audio pull fails. On a machine with working yt-dlp egress this should transcribe;
if not, yt-dlp now often needs a `--cookies-from-browser` / PO-token workaround
(YouTube anti-bot) — a future `transcribe.py` option.

**FINDING (fix before merge):** `lms_scrape.py transcribe-url` exits 0 even when
`transcribe_url` returns `{"ok": false}`, so the dashboard shows the job as
`done`/green. The CLI dispatch should `sys.exit(1)` on `ok is False` → job runner
marks it `failed`.

## G outcome dashboard — live run 2026-09-09

`npm run --workspace ares-dashboard build` then `... start` on `127.0.0.1:4319`,
verified in a browser (light + dark), real data (17 courses, 149 calendar events):

- `GET /api/overview` → 200, full shape. All 10 sections render: KPI strip, Today
  (5 classes with formatted times, 3 due today/tomorrow, 8 changed courses), This
  week (grouped by day, past days filtered), Assignments by grade risk (4, each
  with a Start command + per-course "% ahead"), Exam prep (5 exams, course names
  resolved, brain-ready + practice-set badges), Attendance runway (9 courses,
  three-state flags), Where you stand (17 brains: 2 ready / 8 stale / 7 not-built),
  Needs your input (9 transcribe groups), Chat (locked, 2/17, unlocks at 15).
- Theme: follows `prefers-color-scheme`; palette B (green edge, mint/near-black
  paper). Fixed a Tailwind v4 bug — `@theme` nested in `@media` flattens and the
  dark tokens leaked into light mode.
- Attendance runway math checked against `_attendance.json`: e.g. Power of
  Communication 5/7 = 71% → watch; Crafting Marketing 1/5 = 20%, best case 60% →
  at risk; Entrepreneurship 2/2 = 100% early → on track (one-miss projection is
  suppressed below 4 sessions held).

**Not re-verified this run:** the job actions (Sync / Ingest / Transcribe / upload)
— same job runner + SSE as the F live run above, unchanged. `transcribe` (scraped
YouTube links, no `--inbox`) is a new job kind but the same yt-dlp egress block
applies on this machine.
