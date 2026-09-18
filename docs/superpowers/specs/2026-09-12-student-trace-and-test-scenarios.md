# Student data trace + test-case simulations

Companion to the collaborative-multi-student design spec and its six
implementation plans. Two things: (1) one student's data walked step by
step through the whole system, objective by objective; (2) a description-only
test-case simulation list per flow — what each scenario proves, not test code.

Two students throughout: **Priya** (first to touch the course) and **Arjun**
(joins a day later). Course: `ai-101`.

## Part 1 — Step-by-step trace

### Objective 0: Priya installs the plugin

1. Priya installs the ares-brain plugin, opens the dashboard.
2. **Gate (Build-order 2)** intercepts: `GET /api/setup-state` returns
   `{driveConnected: false, calendarConnected: false, mesaTokenPresent:
false, claudeCliLoggedIn: false, ready: false}`. Every other route 503s.
   The `SetupGate` component renders the 4-row checklist, nothing else.
3. Priya runs `claude setup-token` (fixes `claudeCliLoggedIn`), pastes her
   `MESA_REFRESH_TOKEN` into `.env` (fixes `mesaTokenPresent`), runs
   `calendar-auth` (fixes `calendarConnected` AND `driveConnected` — one
   consent screen grants both scopes now, per Build-order item 1).
4. Next poll: all four true, `ready: true`. `SetupGate` renders the real
   dashboard. **This is the FIRST point at which any of Priya's data
   touches anything outside her machine** — nothing before this step
   contacted Google or Mesa.

### Objective 1: Priya scrapes `ai-101` for the first time

5. Priya syncs. `scrape_steps.py` pulls raw materials/assignments/
   attendance/events from Mesa using HER OWN refresh token (personal,
   never shared — Build-order item 1's scope covers Drive/Calendar only,
   not Mesa auth).
6. `ingest.py` normalizes. For each material: `_normalize_materials` writes
   `courses/ai-101/normalized/material-*.md` locally, THEN (Build-order
   item 3, Task 2) calls `_share_if_written` → `drive_sync.write_if_absent`
   → the file lands in the shared `ai-101` Drive folder for the first time
   (nobody else has scraped this course yet, so every material is a fresh
   write, not a skip).
7. Her assignments/grades/attendance normalize too, but `_normalize_
assignments` was NOT modified by any plan — nothing from this step ever
   reaches Drive. (Test-simulation A3 below proves this directly.)
8. A recording needs transcribing. Build-order item 3 Task 1: `drive_sync.
read_or_none("ai-101", "transcripts/rec-42.md")` → `None` (nobody's
   transcribed it yet) → falls through to the real Gemini transcription →
   writes locally → `write_if_absent` shares it. **Cost incurred once, by
   Priya.**
9. Priya runs `course-brain`. Build-order item 3 Task 3: `drive-guide-
check` → not found → full LLM synthesis runs → `GUIDE.md` written
   locally → `drive-guide-upload` shares it.

### Objective 2: Arjun joins the same course, a day later

10. Arjun goes through Objective 0 identically (his own OAuth grant, his
    own Mesa token — these are never shared, Build-order item 1's
    Global Constraints are explicit about this).
11. Arjun syncs `ai-101`. `_normalize_materials` computes the same content
    hash Priya's material produced (same source PDF from Mesa) →
    `write_if_absent` finds a Drive file with a matching `contentHash` →
    returns `False` (skip) — but Arjun's LOCAL normalized doc is still
    written from his own extraction (Build-order item 3 does not add a
    check-before-extract for materials, only share-after — see that
    plan's Self-Review Notes). Arjun's local corpus ends up byte-identical
    to Priya's, independently produced.
12. Arjun's transcription step: `read_or_none("ai-101", "transcripts/
rec-42.md")` → Priya's transcript comes back → written straight to
    Arjun's local `transcripts/rec-42.md`, **zero Gemini calls**. This is
    the actual payoff of Build-order item 3.
13. Arjun's `course-brain`: `drive-guide-check` → Priya's `GUIDE.md` comes
    back → written locally, `brain-mark-guide` stamps it current, **zero
    LLM synthesis calls**.

### Objective 3: Priya shares a note; Arjun sees it

14. Priya writes a self-note (drops a file in
    `inbox/ai-101/notes/`), runs ingest → normalizes to
    `normalized/self-note-x.md` locally, as always (Build-order item 4
    does not touch this path).
15. Priya explicitly runs `share-note --course ai-101 --path normalized/
self-note-x.md`. Uploads to `notes/Priya/self-note-x.md` in the shared
    folder, returns a link. **Nothing before this explicit action ever
    left Priya's machine.**
16. Arjun's next `build_index` (Build-order item 4 Task 3): pulls
    `drive_sync.list_shared("ai-101", "notes", exclude_subfolder="Arjun")`
    → gets Priya's note (his own subfolder, if he'd shared any, would be
    excluded) → indexes it with `sharedBy: "Priya"`.
17. Arjun runs `/mesa:ares-brain-ask` about a topic Priya's note covers.
    `brain_query` returns a hit with `sharedBy: "Priya"` — visible in the
    answer's citation, not anonymized.

### Objective 4: Priya generates and shares a testprep

18. Priya runs `/mesa:ares-brain-testprep ai-101`. `write_study_artifact`
    writes `study/testprep-20260913.md` locally — same as before any of
    this collaborative work existed. **Not shared yet.**
19. The skill (Build-order item 5 Task 2) asks if she wants to share it.
    She says yes → `share-study --course ai-101 --name testprep-20260913`
    → uploads to `testprep/Priya/testprep-20260913.md`, returns a link.
20. Priya pastes that link in the cohort's group chat, outside ares-brain
    entirely — sharing the LINK is a manual human action, not something
    the system does further.

### Objective 5: Arjun uses the in-dashboard chatbot

21. Arjun types "what's due this week for ai-101?" into the chat panel
    (Build-order item 6).
22. `POST /api/jobs {kind: "chat", message: "..."}` → `startJob` → since
    `kind === "chat"`, dispatches to `runClaude`, NOT `runPython` —
    spawns `claude -p "what's due this week for ai-101?"` with the scoped
    allowlist.
23. Output streams back through the exact same `GET /api/jobs/:id/log` SSE
    endpoint Arjun's earlier sync job used — the `ChatPanel` renders it in
    the same `JobLog` component. Claude's own reasoning + the `brain_query`/
    `daily_brief` MCP tools do the actual work — no logic was reimplemented
    for the chat path.
24. If `claudeCliLoggedIn` had gone false again (e.g. token revoked, the
    exact failure mode debugged earlier this session) — the gate (step 2)
    would have caught it BEFORE Arjun ever saw a chat box, rather than the
    chat silently failing mid-conversation.

---

## Part 2 — Test-case simulations (description only)

Organized by which plan they primarily exercise. Each is a scenario
description, not test code — the actual code lives in each plan's own
Step 1 ("write the failing tests").

### Auth foundation (Build-order 1)

- **A1 — Combined consent grants both scopes.** Simulate a fresh
  `do_auth()` run against a fake OAuth server; assert the resulting
  `token.json` carries both the calendar and drive.file scope strings, not
  just one — proves the "one consent screen" claim, not two separate
  flows bolted together.
- **A2 — Existing calendar users keep working, untouched.** Load a
  `token.json` that predates this change (calendar scope only, no
  drive.file) — a REAL scenario for every current user of this repo, not
  hypothetical. Assert `calendar_sync._service()` still returns a working
  service (calendar functionality doesn't regress just because Drive scope
  didn't exist yet); assert `driveConnected` reports `False` for this same
  token so the gate correctly asks the student to re-consent.
- **A3 — write_if_absent never called for assignment data.** Run the full
  ingest pipeline on a fixture course with materials, assignments, and
  self-notes all present; assert `drive_sync.write_if_absent` was called
  for materials, never for assignments, never for inbox self-notes — the
  cross-review-caught bug this exact scenario would have caught
  immediately if it had existed before that review.
- **A4 — Race: two students transcribe the same recording within
  seconds.** Simulate `write_if_absent` being called twice for the same
  `content_hash` from two "processes" in quick succession (test doesn't
  need real concurrency — two sequential calls with the second one hitting
  an already-uploaded file is the same assertion). Assert the second call
  returns `False` (no duplicate Drive file), and that neither caller
  raises — the spec's documented "no locking, occasional wasted work is
  fine" trade-off actually holds in code, not just in prose.

### Onboarding gate (Build-order 2)

- **G1 — Any one flag false blocks everything.** Four separate simulated
  states, each with exactly one flag false and the other three true;
  assert `GET /api/courses` (an arbitrary existing route) 503s in all four
  cases — proves the gate is an AND, not accidentally an OR or checking
  only a subset.
- **G2 — `/api/setup-state` itself is never gated.** With all four flags
  false, assert `GET /api/setup-state` still returns 200 (not 503) — if
  this endpoint gated itself, the setup screen could never learn it was
  time to stop polling.
- **G3 — Claude CLI revoked mid-session re-triggers the gate.** Simulate
  `ready: true` on first poll, then the `claude` probe starting to fail on
  a later poll (mirrors the exact revoked-token incident from this
  session) — assert the dashboard's next API call gets 503 again, not a
  stale "still ready" state — proves the gate re-checks live, not once at
  startup.
- **G4 — Setup screen never shows a blank state.** Simulate the
  `/api/setup-state` fetch itself failing (network error, not a 503 —
  the server isn't even reachable yet). Assert `SetupGate` keeps
  retrying/rendering the checklist rather than crashing or rendering
  nothing.

### Shared-first sync (Build-order 3)

- **S1 — Second transcription is free.** Simulate Priya's course with one
  untranscribed recording; run the transcribe step twice, "as two
  different students" (swap the mocked `drive_sync.read_or_none` from
  `None` to the just-uploaded content between runs). Assert the underlying
  transcription engine (`_transcribe_audio`) is called exactly once across
  both runs — this is the entire economic case for Build-order item 3,
  and needs a test that actually counts the call, not just checks the
  final file exists.
- **S2 — GUIDE.md sharing survives a courses with zero materials shared
  yet.** Simulate `drive-guide-check` on a brand-new course folder (no
  Drive folder configured at all — `folder_id_for_course` returns `None`).
  Assert it degrades to "not found" cleanly (full local synthesis runs),
  not an exception — proves the "no Drive folder configured yet" case
  from the Global Constraints is real, not just documented.
- **S3 — A corrupted/malformed shared transcript doesn't poison a
  student's local corpus.** Simulate `read_or_none` returning bytes that
  don't parse as valid frontmatter+body. Assert the local write still
  happens (garbage in, but no crash) and `brain.build_index` on that
  corpus doesn't raise — every other normalizer in this codebase already
  has this kind of tolerance (per-item try/except), this scenario proves
  the new shared-read path inherited it rather than becoming the one
  brittle spot.

### Notes sharing (Build-order 4)

- **N1 — Priya never sees her own note twice.** Simulate Priya having
  shared a note, then Priya (not Arjun) rebuilds her own index. Assert
  `list_shared(..., exclude_subfolder="Priya")` means her own shared note
  never comes back through the shared-notes path — she already has it
  locally; double-counting would corrupt result ranking/counts.
- **N2 — Unshared notes are invisible to classmates, full stop.** Simulate
  Priya writing three self-notes locally, sharing only one. Assert
  Arjun's `build_index` + `query` never surfaces the other two under any
  search term drawn from their content — the strongest possible proof of
  the opt-in constraint, since it's a search over content that (if leaked)
  would be trivially findable.
- **N3 — Attribution survives multiple classmates sharing on the same
  topic.** Simulate Priya AND Arjun's classmate "Rahul" both sharing notes
  that each mention the same concept. Assert a `brain_query` for that
  concept returns both hits with their own distinct `sharedBy` values —
  proves attribution doesn't collapse to "last shared" or get lost when
  merging multiple sources.

### Testprep sharing (Build-order 4, testprep half)

- **T1 — Generating never uploads.** Simulate a full testprep generation
  run with `drive_sync.upload_shared` mocked; assert it is NEVER called
  during generation, only when the explicit share action runs afterward —
  the single most important behavior in this plan given how explicitly
  the user asked for opt-in.
- **T2 — Sharing a testprep that doesn't exist fails cleanly.** Simulate
  `share-study` with a `--name` that has no matching `study/*.md` file.
  Assert `{"ok": false, "error": ...}`, not an unhandled exception —
  ordinary user-typo case (wrong name), needs to read as an error message,
  not a stack trace.

### In-dashboard chatbot (Build-order 5)

- **C1 — Chat and sync can't run at the same time.** Simulate starting a
  sync job, then immediately trying to start a chat job before the sync
  finishes. Assert the chat attempt gets the existing `BusyError` → 409
  behavior every other job kind already has — proves the "chat competes
  for the same single job slot" constraint holds without special-casing.
- **C2 — A chat message with only whitespace is rejected before spawning
  anything.** Simulate `POST /api/jobs {kind: "chat", message: "   "}`.
  Assert 400, and that `claude` is never spawned — cheap guard against
  wasting a process launch (and a real API call, since `claude -p` talks
  to Anthropic) on empty input.
- **C3 — Killing a running chat job actually kills the `claude`
  subprocess.** Simulate a chat job mid-stream, call the existing kill
  endpoint. Assert `child.kill("SIGTERM")` was called on the spawned
  `claude` process specifically (not a no-op) — a long chat response the
  student wants to cancel shouldn't keep running in the background after
  they've moved on.
- **C4 — Gate blocks the chat feature specifically when only the CLI
  login is broken.** Simulate `claudeCliLoggedIn: false` with the other
  three flags true. Assert the dashboard is STILL fully gated (not "gate
  everything except chat") — the design's whole point in adding this 4th
  flag was that a broken `claude` login should surface at setup time, not
  as a confusing failure the first time a student tries to chat.

---

## Cross-plan consistency notes (recorded during the review pass)

- Every plan referencing `lms_scrape`'s test-callable function now
  correctly calls `lms_scrape.run(argv)` (the plans initially used a
  `lms_scrape.main(argv)` that doesn't exist in this codebase — caught
  and fixed across Build-order items 3, 4, and 5's plan documents before
  any implementation started).
- Build-order item 3's materials/outline/announcements sharing hook was
  originally drafted inside the shared `_diff_write` helper — which would
  have shared assignment data (a direct violation of the spec's locked
  "assignments never shared" decision), since `_diff_write` is also called
  by `_normalize_assignments`. Corrected to hook the three specific
  normalizer call sites instead, with test A3 above written specifically
  to guard against this regressing.
- `drive_sync`'s filename-flattening scheme (`subpath.replace("/", "__")`)
  is used identically by Build-order items 1, 3, 4, and 5 — verified each
  plan's subpath strings (`materials/<name>`, `transcripts/<id>.md`,
  `guide/GUIDE.md`, `notes/<student>/<name>`, `testprep/<student>/<name>`)
  parse back apart the way `list_shared` (item 4) expects, given `notes`/
  `testprep` are the only prefixes ever listed (not `materials`/
  `transcripts`/`guide`, which are always read by exact known name, never
  listed).
