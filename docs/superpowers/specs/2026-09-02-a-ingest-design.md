# A-ingest Design

**Date:** 2026-09-02
**Status:** Draft for review
**Scope:** Phase A-ingest of the mesa project. Follows A-scrape (shipped, merged @ `e831486`). Produces the `normalized/` corpus + transcripts. No LLM, no brain, no calendar.

---

## 1. Context

A-scrape landed a working pipeline: `scraper/lms_scrape.py all` pulls every Term-1 course's assignments, attendance, events, announcements, topics, materials (with 44 downloaded files), and recording links to `courses/<slug>/raw/`. An MCP server (`mcp/`) exposes `status` + `scrape`. 90 MB scraped, live-verified.

A-ingest turns that raw material — plus files the user drops into `inbox/` — into a stable, plain-text corpus that sub-project B (the "brain": local embeddings + retrieval) will consume, and transcribes class recordings.

### What A-ingest is NOT

No embeddings, no vector index, no retrieval, no `brain_*` tools, no Google Calendar, no daily-job scheduling, no LLM call anywhere, no `briefing`/`mindset`/skill work. Those are B and E.

### Locked cross-cutting decisions (from A-scrape, still binding)

- Python sidecar (`scraper/`, venv via `uv`, Python 3.12) does the work; TypeScript MCP tools drive it; a slash command exposes it. MCP tools are deterministic — no LLM.
- `.env` is a real secret — never read into logs, printed, or committed.
- `courses/` is gitignored (real student data). `mcp/dist/`, `mcp/node_modules/`, `scraper/.venv/`, raw `scraper/tests/fixtures/*` (except `scrubbed/`) not committed.
- Committed test fixtures carry no real PII.
- `ARES_BRAIN_HOME` env overrides the repo root for the data tree; `paths.py` / `mcp/src/config.ts` resolve it.
- Every step is idempotent and resumable; one failure never aborts the whole run (`_run_all` pattern in `lms_scrape.py`).

---

## 2. New decisions (this phase)

| Question                      | Decision                                                                                                                                                                                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Normalization scope           | Study material + light schedule (§4). Full docs for pre-reads/resources/assignments/outline/transcripts/self-notes/books; short entries for `session` events and announcements; attendance / non-session events / exam events stay raw JSON. |
| Course outline                | Auto-fetch the linked Google Sheet via its CSV export URL (no auth for link-shared sheets). Fall back to `inbox/<slug>/notes/` drop on any failure.                                                                                          |
| Recording transcription       | `yt-dlp -x` to pull audio from the YouTube link → `faster-whisper` model **`small`**, auto device (Metal on Apple Silicon, else CPU). `WHISPER_MODEL` env overrides.                                                                         |
| PDF/DOCX/PPTX/XLSX extraction | Fresh extractors in `scraper/extract.py` using `pypdf`, `python-docx`, `python-pptx`, `openpyxl`. No dependency on `pre-read-companion`.                                                                                                     |
| HTML content fields           | `markdownify` → markdown, links preserved (the Google Sheets / workbook URLs matter).                                                                                                                                                        |
| Re-ingest change detection    | Content-hash manifest `normalized/_ingest.json`: `source → {hash, outPath}`. Re-normalize changed/new only; delete orphaned outputs.                                                                                                         |
| `inbox/` layout               | Per-course, typed by subfolder: `inbox/<slug>/{notes,recordings,books}/`. `ingest` creates the skeleton for every course on first run. Top-level `inbox/_unsorted/` for material not tied to one course.                                     |
| Transcript caching            | Keyed by recording id; never re-transcribed once `transcripts/<id>.md` exists.                                                                                                                                                               |

---

## 3. Repository layout (additions)

```
scraper/
  extract.py          pdf/docx/pptx/xlsx -> plain text
  html2md.py          HTML string -> markdown (markdownify wrapper)
  gsheet.py           Google Sheets share link -> CSV rows (or None on failure)
  transcribe.py       yt-dlp audio pull + faster-whisper
  ingest.py           normalize raw/ + inbox/ + transcripts/ -> normalized/
  requirements.txt    + pypdf, python-docx, python-pptx, openpyxl, markdownify, yt-dlp, faster-whisper
  tests/
    fixtures/scrubbed/  + a tiny sample.pdf/.docx/.pptx/.xlsx, outline.csv, a 3-second sample.wav
    test_extract.py, test_html2md.py, test_gsheet.py, test_transcribe.py, test_ingest.py
mcp/src/tools/
  transcribe.ts       spawn `lms_scrape.py transcribe`
  ingest.ts           spawn `lms_scrape.py ingest`
commands/
  course-ingest.md    runs transcribe then ingest, reports counts
courses/<slug>/        (all gitignored)
  inbox/notes/  inbox/recordings/  inbox/books/     created by ingest
  transcripts/<recordingId>.md
  normalized/*.md
  normalized/_ingest.json
courses/inbox/_unsorted/                            top-level, created by ingest
```

New `lms_scrape.py` subcommands: `transcribe [--course SLUG]`, `ingest [--course SLUG]`. Both join `all` in `_run_all` after the scrape steps, each wrapped in the per-course try/except.

---

## 4. `ingest` — normalization rules

For every source below, `ingest` writes one `courses/<slug>/normalized/<stableName>.md`.

### Frontmatter (every file)

```yaml
type: material | assignment | outline | transcript | self-note | book | session | announcement
source: <relative path under courses/<slug>/ , or "api:<kind>:<id>">
title: <string>
course: <course display name>
session: <int> # omitted when unknown
due: <ISO 8601> # assignments only, omitted when null
recordedOn: <YYYY-MM-DD> # transcript only
bodyHash: <sha256 hex of the rendered markdown body — for B's dedupe/versioning>
updatedAt: <ISO 8601 UTC, ...Z>
```

`stableName` = `<type>-<slugified title or source id>.md`, deduped with a numeric suffix on collision.

### Source → output

| Source (under `raw/` unless noted)                                                        | `type`                           | Body                                                                                                                                 |
| ----------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `materials.json` entry, `kind: file`, `localPath` set                                     | `material`                       | `extract.py` on the downloaded file                                                                                                  |
| `materials.json` entry, `kind: text`                                                      | `material`                       | `html2md(content)`                                                                                                                   |
| `materials.json` entry, `kind: link`                                                      | `material`                       | `> <url>` plus the title (one line — it's a pointer, not content)                                                                    |
| `assignments.json` entry                                                                  | `assignment`                     | `html2md(instructions or description)` + a trailing facts block: `Due: …`, `Cutoff: …`, `Submission: file/any`, `Group: yes/no`      |
| outline: the `type: outline` topic's `text` material whose `content` links a Google Sheet | `outline`                        | `gsheet.py` fetches CSV → rendered as a markdown table; each row also emits nothing extra (one `outline` file per course)            |
| `transcripts/<id>.md`                                                                     | `transcript`                     | the transcript markdown (segments with `[hh:mm:ss]`)                                                                                 |
| `inbox/<slug>/notes/*.{md,txt,docx}`                                                      | `self-note`                      | file text (`.docx` via `extract.py`)                                                                                                 |
| `inbox/_unsorted/*`                                                                       | as above but `course: _unsorted` | —                                                                                                                                    |
| `inbox/<slug>/books/*.{pdf,docx}`                                                         | `book`                           | `extract.py`. `.epub` NOT supported — ingest logs "epub unsupported, drop a PDF" and skips it (user confirmed they can submit PDFs). |
| `_events.json` events with `eventType == "session"`                                       | `session`                        | 4-line block: `Session <n?> — <title>` / `<startAt> – <endAt> <timezone>` / `Instructor: <name>` / `Course: <name>`                  |
| `_announcements.json` (program) + `<slug>/raw/announcements.json` (course)                | `announcement`                   | `html2md(body)`, hard-capped at 2000 chars, `title` + `publishedAt` in frontmatter                                                   |

Not normalized (tasks read the raw JSON directly): `_attendance.json`, events where `eventType != "session"`, exam events.

### `_ingest.json` manifest

```json
{
  "sources": {
    "<source key>": { "hash": "<sha256>", "outPath": "normalized/<name>.md" }
  },
  "ingestedAt": "<ISO Z>"
}
```

The manifest `hash` is of the source's **input** (file bytes for files, canonical `json.dumps(entry, sort_keys=True)` for API entries, fetched CSV text for the outline) — distinct from the frontmatter `bodyHash`, which is of the rendered output. On each run: compute each current source's input hash. If it matches the manifest, skip (no rewrite). If changed or new, re-normalize. After processing, any manifest entry whose source no longer exists → delete its `outPath` and drop the entry.

---

## 5. `transcribe` — recordings

Input: `raw/recordings.json` (`[{id, title, videoUrl, provider, recordedOn, ...}]`) + any file in `inbox/<slug>/recordings/`.

Per item, if `transcripts/<id>.md` (or `transcripts/inbox-<filename>.md`) does not exist:

1. **YouTube link:** `yt-dlp -x --audio-format m4a -o <tmp>/<id>.%(ext)s <videoUrl>`. On failure (private, removed, geo-block, yt-dlp missing) → append `{id, status: "needs-manual"}` to `courses/<slug>/transcripts/_failed.json`, continue. Never raise.
2. **Inbox file:** use as-is.
3. Run `faster-whisper` (`WhisperModel(os.environ.get("WHISPER_MODEL","small"), device="auto", compute_type="int8")`), `transcribe(audio, vad_filter=True)`.
4. Write `transcripts/<id>.md`: frontmatter `{type: transcript, source, title, course, recordedOn}` + body = one line per segment `[hh:mm:ss] text`.
5. Delete the temp audio.

Returns `{transcribed: [...], skipped: [...], failed: [...]}`.

`faster-whisper` model download (~500 MB for `small`) happens on first use into the HF cache; the README documents this and the `~2-4 min/hour on Apple Silicon, ~10-15 min CPU` expectation.

---

## 6. MCP tools

- **`transcribe({ course? })`** — spawns `lms_scrape.py transcribe [--course …] --json`, returns the summary. Missing venv or missing `yt-dlp`/`faster-whisper` → the same "sidecar not set up" error shape the `scrape` tool uses, listing the extra install step.
- **`ingest({ course? })`** — spawns `lms_scrape.py ingest [--course …] --json`, returns `{perCourse: {slug: {normalized, skipped, orphansDeleted}}, errors: [...]}`.
- `status` tool gains: per course, `transcripts` and `normalized` file counts (it already scans those dirs — confirm the counts are wired), and `lastIngest` from `normalized/_ingest.json` `ingestedAt`.

`/mesa:ares-brain-course-ingest [course]` command: calls `transcribe` then `ingest`, reports transcript counts, normalized counts, and any `needs-manual` recordings verbatim.

---

## 7. Testing

- **`extract.py`:** commit a tiny 1-page `sample.pdf`, 1-paragraph `sample.docx`, 2-slide `sample.pptx`, 2×2 `sample.xlsx` (all synthetic, no PII). Assert each returns the known text. Unknown extension → clear error, no crash.
- **`html2md.py`:** table test — a `<p><a href>` blob → markdown link preserved; nested lists; empty string → empty.
- **`gsheet.py`:** fixture `outline.csv`; test the URL-extraction regex against the real outline `content` HTML (in a scrubbed fixture), and the CSV→rows parse. Network call itself stubbed (`requests.get` monkeypatched) — one test for 200, one for 403 → returns `None`.
- **`transcribe.py`:** commit a 3-second `sample.wav` of spoken words; run the real `small` model in one slow test (marked, still run in CI) asserting the transcript file has valid frontmatter and a non-empty body — not exact text. `yt-dlp` path: monkeypatch the subprocess, assert failure → `_failed.json` entry, no raise.
- **`ingest.py`:** a fake course tree with one of each source type; assert one normalized file per, frontmatter valid, `_ingest.json` written. Second run with nothing changed → `skipped` == all, zero rewrites (assert mtimes unchanged). Change one source → only that one re-normalized. Remove a source → its output deleted, manifest entry gone.
- **MCP tools:** temp `ARES_BRAIN_HOME`, stub the python spawn, assert argv + summary parsing (mirror the `scrape` tool tests).
- **Live run** (final task): `transcribe` one real recording end-to-end, then `ingest` the full 90 MB tree; record counts and any failures in `docs/lms-api.md`.

---

## 8. Build order (one spec, staged plan)

1. `extract.py` + `html2md.py` + their fixtures/tests — pure functions.
2. `gsheet.py` — link regex + CSV fetch + fallback.
3. `transcribe.py` + `transcribe` subcommand + `transcribe` MCP tool.
4. `ingest.py` + `_ingest.json` + `ingest` subcommand + `ingest` MCP tool + inbox-skeleton creation.
5. `_run_all` wiring (`transcribe` then `ingest` after the scrape steps), `/mesa:ares-brain-course-ingest` command, README update, `status` count wiring, live run.

---

## 9. Open items

1. ~~`.epub` books~~ — RESOLVED: epub not supported. Books are PDF or DOCX; ingest skips epub with a message. No `ebooklib` dependency.
2. **Outline sheet format** — real Mesa outline sheets are unseen. `gsheet.py` returns raw rows; `ingest` renders them as a table without assuming column meaning. If a later task finds a consistent `Session | Date | Topic | Pre-read` schema, tighten then.
3. **yt-dlp + YouTube "live" URLs** — `https://www.youtube.com/live/<id>` is a finished-stream VOD; `yt-dlp` handles these, but rate-limiting / bot-checks on a batch of 20 are possible. Task 3 does one real pull to confirm; if batch pulls get throttled, add a delay + resume.
