# Sub-project B — Course Brain Design

**Date:** 2026-09-03
**Status:** Draft for review
**Scope:** Sub-project B of the mesa-course-agent project. Follows A-scrape + A-ingest (both shipped, merged to `main` @ `3ca485f`). Makes the `normalized/` corpus queryable and course-aware, and delivers objective 2 (pre-class briefing) and objective 9 (per-course "brain"). No calendar, no scheduling.

---

## 1. Context

A-ingest produces `courses/<slug>/normalized/*.md` — one markdown file per source item with YAML frontmatter (`type, source, title, course, session?, due?, recordedOn?, bodyHash, updatedAt`) and a `normalized/_ingest.json` content-hash manifest. Current live corpus: **251 files, 771 KB total** (~48 KB/course), types: session 132, material 78, outline 18, assignment 12, announcement 9, transcript 2. Only transcripts are large (up to 79 KB); a recordings-heavy course reaches 2+ MB of transcript by term end.

Sub-project B turns that corpus into:

- a searchable index (structured filter + full-text) — **no embeddings yet**;
- a Claude-generated per-course `GUIDE.md` plus a hand-editable `course.md`;
- the pre-class briefing: `/course-brief <course>` (one session, deep) and `/week-ahead` (all courses, next 7 days).

### What B is NOT

No embeddings / vector index (deferred — see §7). No Google Calendar, no OAuth, no `launchd` / scheduling, no assignment-solver / test-prep / book-summary (those are sub-project C). No LLM call inside any MCP tool — tools stay deterministic; reasoning happens in skills/commands that Claude Code runs.

### Locked cross-cutting decisions (still binding)

- Python sidecar (`scraper/`, `uv` venv, Python 3.12) does deterministic work; TypeScript MCP tools (`mcp/`, `@modelcontextprotocol/sdk@1.30.0`, low-level `Server`) drive it; slash commands + skills do the reasoning.
- `.env` is a real secret — never read into logs, printed, or committed. B does not need `.env` (works entirely off `courses/` on disk).
- `courses/` is gitignored. `mcp/dist/`, `mcp/node_modules/`, `scraper/.venv/`, raw `scraper/tests/fixtures/*` (except `scrubbed/`) not committed. Committed fixtures carry no real PII.
- `COURSE_AGENT_HOME` overrides the data-tree root; resolve through `paths.py` (`HOME`, `course_dir`, `courses_root`, `global_file`, `ensure`, `slugify`) / `mcp/src/config.ts`.
- Every step idempotent + resumable; one failure never aborts a run. All JSON writes via `scrape_steps._write_json`.

---

## 2. New decisions (this phase)

| Question                   | Decision                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Retrieval mechanism        | SQLite **FTS5** full-text + frontmatter-column filter over `normalized/*.md`. Embeddings deferred until a single course's corpus exceeds **150 KB of body text** — at which point `brain_status` flags it and a later phase adds `transformers.js` embeddings. Not built now.                                                                                                        |
| Per-course "brain" content | `courses/<slug>/brain/`: `index.sqlite` (FTS), `GUIDE.md` (Claude-generated overview), `course.md` (hand-editable focus notes), `_brain.json` (metadata).                                                                                                                                                                                                                            |
| Who generates `GUIDE.md`   | Claude Code, via a `brain-build` skill, on demand. `brain_status` reports staleness ("guide is N sources behind"). No API key, no cost when idle.                                                                                                                                                                                                                                    |
| Briefing outputs           | Both: `/course-brief <course>` (next session of one course, deep) **and** `/week-ahead` (every session/exam in the next 7 days across all courses, shallower). Shared `briefing` skill. `/week-ahead`'s assembler is reused by sub-project E's daily digest later.                                                                                                                   |
| Next-session detection     | Current session № = `courses/_attendance.json` `byCourse[slug].sessionsConducted` (which A-ingest derived from attendance `total`, i.e. classes conducted — not personal attendance). Next session = earliest `courses/_events.json` event with `eventType == "session"`, `courseSlug == slug`, `startAt` in the future. Fallback: next `outline` row by date if events are missing. |
| Outline parsing            | The outline sheet's column schema is unvalidated (carried open item from A). `brain.py` parses the outline `normalized` doc's markdown table: if it has columns matching `/session/i`, `/date/i`, `/topic/i` (case-insensitive, any order), extract structured rows; else expose the raw table only. Briefing uses structured rows when available.                                   |

---

## 3. Repository layout (additions)

```
scraper/
  brain.py            FTS5 index build + query; next-session resolver; outline table parse
  tests/
    fixtures/scrubbed/  + a small normalized/ tree fixture for brain tests
    test_brain.py
mcp/src/tools/
  brain_query.ts      structured filter + FTS search -> ranked results
  brain_status.ts     per-course corpus/index/guide freshness
mcp/test/
  brain_query.test.ts, brain_status.test.ts
commands/
  course-brain.md     trigger the brain-build skill for a course
  course-brief.md      per-session brief, one course
  week-ahead.md        next-7-days brief, all courses
skills/
  brain-build/SKILL.md   read a course's corpus -> write brain/GUIDE.md
  briefing/SKILL.md       shared per-session / week assembly logic
courses/<slug>/brain/     (gitignored)
  index.sqlite
  GUIDE.md
  course.md
  _brain.json          {guideBuiltFromHash, guideBuiltAt, indexBuiltAt, sourceCount, corpusBytes}
```

New `lms_scrape.py` subcommands: `brain-index [--course SLUG]` (build/refresh the FTS index), `brain-query <json>` (used by the MCP tool), `brain-status [--course SLUG]`, `next-session --course SLUG`. All read `courses/` off disk — no LMS auth.

`brain-index` also joins `_run_all` (the `all` orchestrator) after `ingest`, wrapped in try/except → `errors`. It is cheap (FTS over <1 MB).

---

## 4. `brain.py`

### FTS index (`build_index(slug) -> dict`)

- SQLite at `courses/<slug>/brain/index.sqlite`. One virtual table:
  ```sql
  CREATE VIRTUAL TABLE docs USING fts5(
    path UNINDEXED, course UNINDEXED, type UNINDEXED,
    session UNINDEXED, due UNINDEXED, title, body,
    tokenize = 'porter unicode61'
  );
  ```
- Rebuild strategy: read `normalized/_ingest.json`; if the set of `outPath`s or any file's mtime changed since `_brain.json.indexBuiltAt`, drop and rebuild the table (simplest; the corpus is tiny). Store `indexBuiltAt`, `sourceCount`, `corpusBytes` in `_brain.json`.
- Frontmatter is parsed with `yaml.safe_load` on the `---`-fenced block (A-ingest now emits valid YAML). A file whose frontmatter fails to parse is indexed with `title` from the filename and logged, not skipped.

### Query (`query(slug_or_none, *, type=None, session_min=None, session_max=None, due_before=None, text=None, limit=20) -> list[dict]`)

- `slug=None` → query every course's index (opens each `index.sqlite`).
- Column filters (`type`, `session` range, `due < due_before`) applied as SQL `WHERE`.
- `text` → FTS `MATCH` on `title`/`body`; rank by `bm25(docs)`.
- No `text` → order by `session` then `updatedAt` desc.
- Each result: `{path, course, type, session, title, due, snippet, score}`. `snippet` via FTS5 `snippet()` (or the first 300 body chars when no `text`).

### Next-session resolver (`next_session(slug) -> dict | None`)

```json
{
  "sessionsConducted": 4,
  "nextIndex": 5,
  "startAt": "2026-09-05T04:00:00.000Z",
  "endAt": "2026-09-05T05:30:00.000Z",
  "title": "…",
  "outlineRow": { "session": "5", "date": "…", "topic": "…", "preRead": "…" } | null,
  "prereadPaths": ["normalized/material-….md", …],
  "source": "events" | "outline" | "attendance-only"
}
```

- `sessionsConducted` from `courses/_attendance.json` `byCourse[slug].sessionsConducted` (0 if absent).
- Next event: earliest `courses/_events.json` event, `eventType=="session"`, `courseSlug==slug`, `startAt > now`.
- `outlineRow`: from the parsed outline table (§4 outline parse), matched on `nextIndex` when a `session` column exists.
- `prereadPaths`: `query(slug, type="material", session_min=nextIndex, session_max=nextIndex)` plus any `material` whose title contains "pre-read"/"preread" and matches the session.

### Outline table parse (`parse_outline(slug) -> {"columns": [...], "rows": [ {..} ], "structured": bool}`)

- Read the `type: outline` normalized doc for the course; extract the first markdown table.
- `structured` = the header row has cells matching `session`, `date`, and `topic` (case-insensitive substring). Then each row → `{session, date, topic, preRead?}` keyed by the matched columns.
- Else `structured=false`, `rows` = raw list-of-lists.

---

## 5. MCP tools

- **`brain_query({ course?, type?, sessionMin?, sessionMax?, dueBefore?, text?, limit? })`** — spawns `lms_scrape.py brain-query '<json>'`, returns `{ results: [...], indexBuiltAt: "…" | null }`. If a course's index is missing → the tool first runs `brain-index --course <slug>` (or returns `{needsIndex: true}` — pick: **auto-build**, since it's cheap).
- **`brain_status({ course? })`** — per course: `{ slug, corpusBytes, sourceCount, indexBuiltAt, indexStale: bool, guideBuiltAt: "…"|null, guideSourcesBehind: int, embeddingsRecommended: bool }`. `guideSourcesBehind` = count of manifest sources whose `bodyHash` differs from what `_brain.json.guideBuiltFromHash` covered (store the guide-time manifest hash-set; diff cardinality). `embeddingsRecommended` = `corpusBytes > 150_000`.
- The existing **`status`** tool gains a top-level `brains: [{slug, indexBuiltAt, guideBuiltAt}]` summary line (reuse `brain_status` internals).

MCP tools remain deterministic — none call an LLM.

---

## 6. Skills & commands

### `brain-build` skill (`skills/brain-build/SKILL.md`)

Trigger: `/course-brain <course>` command, or when `brain_status` shows `guideSourcesBehind` high.

Steps the skill instructs Claude Code to follow:

1. `brain_status` for the course → confirm it's worth rebuilding.
2. Read the course's normalized corpus. If `corpusBytes > ~120 KB`, read the non-transcript docs in full + `brain_query(course, type="transcript")` snippets + the most recent transcript in full; else read everything.
3. Read the existing `brain/course.md` (hand notes) so the guide respects the user's stated focus.
4. Write `courses/<slug>/brain/GUIDE.md`: **Overview** (what the course is building toward), **Key concepts & frameworks** (each with a one-line definition + which sessions cover it + source links), **Session arc** (how sessions connect), **Glossary**, **Open threads** (unresolved questions from transcripts/notes).
5. Call a `brain_mark_guide` tool (or write `_brain.json` directly via a tiny `brain-mark-guide` subcommand) to stamp `guideBuiltFromHash` + `guideBuiltAt`.

On first run for a course, also write a `brain/course.md` template:

```markdown
# <Course> — my focus notes

<!-- Edit freely. Loaded as context whenever the agent answers about this course. -->

## What the professor emphasises

## Exam / assessment style

## Topics I'm weak on

## Things to remember
```

### `briefing` skill (`skills/briefing/SKILL.md`)

Shared logic for both commands. Given a course + a session (or a date window):

1. `next_session` (via a `next-session` subcommand / a `brain_next_session` tool) for the target session's index, date, outline row, pre-read paths.
2. Read those pre-reads in full; `brain_query(course, sessionMax=nextIndex)` for related earlier material; read `brain/GUIDE.md` + `brain/course.md`.
3. Write the brief: **What this session covers**, **Read first** (ordered, with why), **Questions to hold while reading**, **How it connects** to prior sessions, **Prep checklist** (any assignment due before/at the session).

### `/course-brief <course>` command

Invokes `briefing` for the next session of one course. Deep. Output to stdout (Claude Code renders it) — no file written unless the user asks.

### `/week-ahead` command

Invokes `briefing` in "week" mode: every `courses/_events.json` event with `eventType in ("session","exam")` and `startAt` within 7 days. For each, a 3-5 line summary (course, session topic, one must-read, any assignment due). Groups by day. This assembler is what sub-project E's daily digest will call.

### `/course-brain <course>` command

Invokes the `brain-build` skill for one course.

---

## 7. Embeddings — explicitly deferred

Not built in B. The trigger to add them (a later mini-phase): `brain_status` reports `embeddingsRecommended: true` (a course's `corpusBytes > 150 KB`), i.e. once ~2 recordings-heavy courses accumulate transcripts. At that point: chunk the large docs (headings + ~500-token windows, 15% overlap) and `brain_query` blends BM25 + cosine. The FTS interface designed here does not change — embeddings are additive.

**Store decision at that point (SQLite vs Postgres+pgvector).** B uses SQLite FTS5 because B has no vectors, the corpus is <1 MB, and a per-course file needs zero ops / travels with `courses/`. Reopen the store choice when adding embeddings, choosing Postgres + pgvector only if _all_ of: the total corpus has grown past ~100s of MB; a single shared vector store across courses/terms/devices is wanted; and a persistently-running DB server is acceptable as a dependency of the daily job. Otherwise stay on SQLite with a local vector extension (`sqlite-vec`) or an in-process cosine scan — both keep the zero-ops property. Default expectation: stay SQLite.

---

## 8. Testing

- **`brain.py`:** a committed fixture `normalized/` tree (5-6 synthetic docs — one per type, invented content, one with a markdown outline table, one "long" doc). Tests: `build_index` creates the table + `_brain.json`; `query` column filters (type, session range, due_before); `query` FTS ranking (a doc containing the search term ranks above one that doesn't); `query(slug=None)` spans courses; a malformed-frontmatter doc is still indexed; `next_session` with events present, with only an outline, with neither; `parse_outline` structured vs unstructured.
- **Index freshness:** build, assert `indexStale` false; touch a normalized file, assert `indexStale` true; rebuild, false again. A rebuild with nothing changed does not bump `indexBuiltAt` beyond a no-op (or does — but must be idempotent in output).
- **MCP tools:** temp `COURSE_AGENT_HOME`, seed a fake brain tree, stub the python spawn, assert argv + result parsing (mirror `scrape`/`ingest` tool tests). One test that `brain_query` auto-builds a missing index.
- **`_run_all` wiring:** `brain-index` runs after `ingest`, failure → `errors` entry, doesn't abort.
- **Skills:** no automated test (they're Claude-Code-executed) — the live run is the check.
- **Live run** (final task): `brain-index` all courses; `brain_query` a few real questions; run `/course-brain business-frameworks-with-pranjal-bangani` and `/course-brief` for one course and `/week-ahead`; eyeball GUIDE.md quality and the briefs. Record in `docs/lms-api.md`.

---

## 9. Build order (one spec, staged plan)

1. `brain.py` FTS `build_index` + `query` + `brain-index`/`brain-query` subcommands + `brain_query` MCP tool.
2. `next_session` + `parse_outline` + `next-session` subcommand + `brain_next_session` MCP tool.
3. `brain_status` (staleness + `embeddingsRecommended`) + `brain-status` subcommand + `brain_status` MCP tool + `status` tool `brains` field.
4. `briefing` skill + `/course-brief` + `/week-ahead` commands.
5. `brain-build` skill + `course.md` template + `brain-mark-guide` subcommand + `/course-brain` command.
6. `_run_all` wiring + README + live run + findings.

---

## 10. Open items

1. **`brain_next_session` vs a subcommand the skill shells:** skills can't call MCP tools directly in all setups — they ask Claude Code to call the tool. Provide both a `next-session` CLI subcommand (for scripts / the daily job) and a `brain_next_session` MCP tool (for the skill flow). Task 2 builds both off the same `brain.py` function.
2. **`course.md` never overwritten:** `brain-build` writes the template only when `brain/course.md` is absent. Confirmed — it is the user's file.
3. **Outline row → session mapping** when the outline has no `session` column: fall back to matching by date proximity to the next event. Task 2 decides based on the real fixture; if flaky, expose the raw table and let the briefing skill reason over it.
