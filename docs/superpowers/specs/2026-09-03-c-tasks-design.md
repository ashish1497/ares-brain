# Sub-project C — Task Commands Design

**Date:** 2026-09-03
**Status:** Draft for review
**Scope:** Sub-project C of the mesa-course-agent project. Follows A-scrape + A-ingest + B-brain + D-calendar (all merged to `main`). Delivers objective 4 (step-by-step assignment guidance), objective 5 (test-prep questions), objective 6 (book summaries), plus ad-hoc course Q&A. No scheduling, no calendar.

---

## 1. Context

B-brain gave the corpus (`courses/<slug>/normalized/*.md`, YAML frontmatter `type/source/title/course/session?/due?/recordedOn?/bodyHash/updatedAt`), a SQLite FTS index, `brain_query` (snippets + column filters), `brain_next_session`, `brain_status`, per-course `brain/GUIDE.md` (Claude-generated overview) + `brain/course.md` (hand-edited focus notes). A-ingest normalizes dropped books (`inbox/<slug>/books/*.{pdf,docx}` → `normalized/book-*.md`, `type: book`).

Sub-project C adds four study capabilities that reason over that corpus, persisting their output as regenerable artifacts under `courses/<slug>/study/`.

### What C is NOT

No LLM call inside any MCP tool (tools stay deterministic — reasoning is in skills Claude Code runs). No scheduling / `launchd`. No calendar. No changes to scrape / ingest pipeline behaviour beyond one new ingest rule (book summaries → corpus). No grading or submission of the user's actual coursework — `assignment-help` produces guidance and a skeleton, never a submittable draft.

### Locked cross-cutting decisions (still binding)

- Python sidecar (`scraper/`, `uv` venv, Python 3.12) does deterministic work; TypeScript MCP tools drive it; slash commands + skills do the reasoning.
- `.env` is a real secret — never read/printed/committed. C does not use `.env` or contact the LMS or Google — it reads `courses/` off disk.
- `courses/` is gitignored (`study/` included). Not committed: `mcp/dist/`, `mcp/node_modules/`, `scraper/.venv/`, raw `scraper/tests/fixtures/*` (except `scrubbed/`). Committed fixtures synthetic, no PII.
- `brain.py` imports stay stdlib + `yaml` + `from paths import ...` — it must NOT import `scrape_steps` (transitively loads `mesa_api` → `.env`). New brain functions honour this.
- `COURSE_AGENT_HOME` overrides the data-tree root; resolve through `paths.py`.
- Every step idempotent + resumable; one failure never aborts a run.
- New CLI subcommands read `courses/` off disk — no `mesa_api` import, no auth.
- Skills are Claude-Code-executed markdown; they may only instruct calling existing MCP tools + Read/Write, never invent tools.

---

## 2. New decisions (this phase)

| Question                    | Decision                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Retrieval for full doc text | New `brain_get({course, path})` MCP tool + `brain-get --course --path` CLI → returns `{path, frontmatter, body}` for `courses/<course>/normalized/<path>`. Path is validated to resolve inside that course's `normalized/` dir (no traversal). `brain_query` snippets stay for discovery; `brain_get` for the full read.                                      |
| Where study artifacts live  | `courses/<slug>/study/` (gitignored, regenerable). Filenames: `assignment-<assignmentSlug>-<YYYYMMDD>.md`, `testprep-<YYYYMMDD>.md` (or `testprep-s<N>-<M>-<YYYYMMDD>.md` for a session range), `book-<bookSlug>-summary.md`. Frontmatter on every artifact: `type, generatedAt, course, sources: [<normalized path>], sourceHashes: [<bodyHash>]`.           |
| `assignment-help` depth     | Approach + worked skeleton, NOT a submittable draft. If the assignment's `mySubmissionStatus` is `submitted` (from its `raw/assignments.json` record), the skill says so and asks the user to confirm before continuing.                                                                                                                                      |
| `testprep` format           | ~15 questions: recall / application / 1-2 mini-case, difficulty-labelled. Each followed by a `<details><summary>Model answer</summary>…</details>` block (model answer or rubric). Default scope = sessions conducted so far (`brain_next_session.sessionsConducted`); `/testprep <course> <N>-<M>` overrides.                                                |
| `book-summary`              | For each `type: book` doc in the course: a structured summary (thesis, key ideas per part, frameworks, memorable examples, connections to the course) → `study/book-<bookSlug>-summary.md`. Then scans transcript + self-note docs for book titles mentioned but absent from `inbox/<slug>/books/`, and lists them ("upload these to `inbox/<slug>/books/`"). |
| Book summary → brain        | `book-summary` writes only to `study/`. A new `ingest` rule normalizes `courses/<slug>/study/book-*-summary.md` → `normalized/book-summary-<bookSlug>.md` (`type: book-summary`). `ingest` remains the sole writer of `normalized/`; `brain-index` picks the new doc up on its next run, making book summaries searchable by `ask` / `testprep`.              |
| `ask`                       | Ephemeral. `brain_query` → `brain_get` the top hits → answer with source citations (`normalized/…md`). If the corpus doesn't support an answer, says "not in the course material" rather than guessing. No file written.                                                                                                                                      |
| Auto-run                    | None of the four run in `lms_scrape.py all`. All on-demand via slash commands.                                                                                                                                                                                                                                                                                |

---

## 3. Repository layout (additions)

```
scraper/
  brain.py            + get_doc(slug, path) -> {"path","frontmatter","body"} | None
                      + study_dir(slug), write_study_artifact(...), list_study(slug)
  ingest.py           + _normalize_study_book_summaries (study/book-*-summary.md -> type "book-summary")
  lms_scrape.py       + brain-get subcommand
  tests/
    fixtures/scrubbed/brain_corpus/   + a book doc + a transcript that names a missing book
    test_brain_get.py, test_study.py
mcp/src/tools/
  brain_get.ts
mcp/test/
  brain_get.test.ts
commands/
  ask.md   assignment-help.md   testprep.md   book-summary.md
skills/
  ask/SKILL.md
  assignment-help/SKILL.md
  testprep/SKILL.md
  book-summary/SKILL.md
courses/<slug>/study/     (gitignored)
```

`brain_status` gains `studyArtifacts: int` (count of `study/*.md`).

---

## 4. `brain.py` additions

### `get_doc(slug: str, path: str) -> dict | None`

- Resolve `target = (course_dir(slug) / "normalized" / <basename or relative path>).resolve()`.
- Reject (return `None`) if `target` is not inside `(course_dir(slug) / "normalized").resolve()`, or does not exist, or is not a `.md` file.
- Read, `parse_frontmatter` → `{"path": f"normalized/{target.name}", "frontmatter": <dict>, "body": <str>}`.

### `study_dir(slug) -> Path` → `course_dir(slug) / "study"`.

### `write_study_artifact(slug, name, *, type_, course_name, body, sources: list[str], source_hashes: list[str]) -> Path`

- `ensure(study_dir(slug))`; write `study/<name>.md` with frontmatter:
  ```
  ---
  type: <type_>
  course: <course_name>
  generatedAt: <ISO Z>
  sources:
    - <path>
  sourceHashes:
    - <hash>
  ---
  <body>
  ```
- (Skills call the `brain-write-study` subcommand — §5 — rather than writing the file directly, so the frontmatter format is enforced in one place. The skill supplies `type_/name/body/sources`; the subcommand computes `generatedAt` and looks up `sourceHashes` from the current manifest for each `sources` path.)

### `list_study(slug) -> list[dict]` → `[{name, type, generatedAt}]` from each `study/*.md` frontmatter.

---

## 5. CLI subcommands (all read `courses/` off disk, no auth)

- **`brain-get --course SLUG --path REL [--json]`** → `get_doc` result, or `{"error": "not found"}` (exit 0).
- **`brain-write-study --course SLUG --name NAME --type TYPE --sources 'a.md,b.md' [--json]`** — reads the artifact body from **stdin**, resolves `sourceHashes` from `normalized/_ingest.json` (a `sources` path with no manifest entry → its hash is `""`), writes `study/<name>.md`. Prints `{"path": "study/<name>.md"}`.
- **`brain-status`** already exists; extend its per-course dict with `studyArtifacts`.

`brain-get` also joins nothing — it's a read tool.

---

## 6. MCP tools

- **`brain_get({ course, path })`** — spawns `brain-get --course <course> --path <path> --json`. Returns `{ ok, summary, stderr }`. `summary` is the `{path, frontmatter, body}` object (or `{error}`).
- The existing `brain_status` tool automatically carries the new `studyArtifacts` field (it forwards the subcommand output).
- **`brain_write_study`** is NOT an MCP tool — skills call `brain-write-study` via the Bash tool with the body on stdin (an MCP tool passing a multi-KB artifact body through a JSON arg is clumsy; a heredoc to the CLI is cleaner and skills already use Bash).

---

## 7. Skills & commands

Each skill's `SKILL.md` frontmatter: `name`, `description`. Each command's frontmatter: `description`.

### `ask` — `/ask <course> "<question>"`

1. Match the course name/partial to a slug (`courses/_index.json`).
2. `brain_query({course, text: "<question>", limit: 8})`.
3. `brain_get` the top 3-5 hits (and `GUIDE.md` / `course.md` via Read).
4. Answer in 150-400 words, **every claim cited** as `[normalized/<file>.md]`. If nothing relevant: "That's not in the course material for <course> — the closest I found is …".
5. Write nothing.

### `assignment-help` — `/assignment-help <course> "<assignment title>"` (or an assignment id)

1. Find the assignment's `normalized/assignment-*.md` (by title match) + read its `raw/assignments.json` record for `mySubmissionStatus`, `instructions`, linked `materials`.
2. If `mySubmissionStatus == "submitted"`: tell the user, ask to proceed anyway; stop unless they confirm.
3. `brain_get` the assignment doc, its linked workbook/pre-read materials, `brain_query({course, sessionMax: <assignment session>})` for context, `GUIDE.md` + `course.md`.
4. Produce (and persist via `brain-write-study`, `type: assignment-help`, name `assignment-<slug>-<date>`):
   - **What's being asked** — 2-3 sentences.
   - **What to use** — the frameworks, the specific data/exhibits, from which source.
   - **Step plan** — ordered, each step one line.
   - **Worked skeleton** — the structure of the answer with key points filled in and, for each number/claim, where it comes from. NOT prose you could submit.
   - **Watch-outs** — common mistakes, the grading emphasis (from `course.md` if noted).
5. Tell the user the artifact path.

### `testprep` — `/testprep <course> [N-M]`

1. Resolve session scope: default `1`–`sessionsConducted` (from `brain_next_session`), or the `N-M` arg.
2. `brain_query({course, sessionMax: M})` + `brain_get` a spread of material/session/transcript docs + `GUIDE.md` + `course.md`.
3. Generate ~15 questions across **Recall** (3-4), **Application** (7-8, each a 2-3 sentence scenario), **Mini-case** (1-2, a short exhibit + 2-3 sub-questions). Label each `[Recall|Application|Case · Easy|Medium|Hard]`. After each, `<details><summary>Model answer</summary>` … `</details>`.
4. Persist via `brain-write-study` (`type: testprep`, name `testprep[-s<N>-<M>]-<date>`). Tell the user the path.

### `book-summary` — `/book-summary [course]`

1. For the course (or ask which if none given), list `type: book` docs via `brain_query({course, type: "book"})`.
2. For each: `brain_get` the full body → write a summary (thesis; key ideas grouped by the book's own parts/sections; frameworks/models with a one-line definition; 2-3 memorable examples; **how it connects to this course** — cross-reference `GUIDE.md` concepts). Persist via `brain-write-study` (`type: book-summary`, name `book-<bookSlug>-summary`).
3. Mention scan: `brain_query({course, type: "transcript", text: "book read recommend author"})` + `type: "self-note"` similarly; `brain_get` the hits; extract candidate book titles/authors; drop any already present as a `type: book` doc; list the rest as "Mentioned in class but not uploaded — drop the PDF into `inbox/<slug>/books/` and re-run `/course-ingest`".
4. Tell the user which summaries were written and the missing-book list.

---

## 8. `ingest` change — book summaries into the corpus

New per-course normalizer `_normalize_study_book_summaries(slug, course_name, old_sources, errors)` added to `_NORMALIZERS_API`:

- Glob `courses/<slug>/study/book-*-summary.md`.
- For each: `key = f"study:book-summary:{path.stem}"`, `input_hash = sha256(file bytes)`, body = the file's body after its frontmatter.
- `_diff_write(... type_="book-summary", source=f"study/{path.name}", title=<from frontmatter or stem>, ...)` → `normalized/book-summary-<slug>.md` (agent-written artifacts carry no `title`, so the fallback strips the `book-`/`-summary` affixes from the stem: `book-lean-startup-summary` → `lean-startup`).
- Same skip/rewrite/orphan semantics as every other normalizer (a deleted `study/` summary → its `normalized/` doc is orphan-deleted on the next ingest).

This is the only pipeline behaviour change. `study/` files of other types (`assignment-help`, `testprep`) are **not** ingested — they're personal working docs, not course knowledge.

---

## 9. Testing

- **`get_doc`:** fixture `brain_corpus` gains a `book-*.md`. Tests: valid path → `{path, frontmatter, body}`; `../` traversal → `None`; nonexistent → `None`; non-`.md` → `None`; a course with no `normalized/` → `None`.
- **`write_study_artifact` / `brain-write-study`:** body on stdin → `study/<name>.md` with the exact frontmatter, `generatedAt` present, `sourceHashes` resolved from `_ingest.json` (a source not in the manifest → `""`). `list_study` reads them back.
- **`brain_status.studyArtifacts`:** 0 when `study/` absent; N after writing N.
- **`_normalize_study_book_summaries`:** a `study/book-x-summary.md` → a `normalized/book-summary-x.md` (`type: book-summary`) after `step_ingest`; second run unchanged → skipped; delete the `study/` file → the normalized doc orphan-deleted; the `book-summary` doc is then indexed by `build_index` and returned by `query(type="book-summary")`.
- **MCP `brain_get` tool:** temp `COURSE_AGENT_HOME`, stub the spawn, assert argv + summary parsing; a missing doc → `{error}` surfaced.
- **Skills:** no automated test (Claude-Code-executed). The live run is the check.
- **Live run** (final task): `/ask` a real course question (check citations point at real docs); `/assignment-help` for a real unsubmitted assignment (check the artifact + that it's a skeleton not a draft); `/testprep` for one course (check ~15 Qs + collapsible answers); drop a real recommended book PDF into `inbox/<slug>/books/`, `/course-ingest`, `/book-summary`, then `/course-ingest` again and confirm the summary is searchable. Record in `docs/lms-api.md`.

---

## 10. Build order (one spec, staged plan)

1. `get_doc` + `brain-get` subcommand + `brain_get` MCP tool + fixture book doc.
2. `study_dir`/`write_study_artifact`/`list_study` + `brain-write-study` subcommand + `brain_status.studyArtifacts`.
3. `ask` skill + `/ask` command.
4. `assignment-help` skill + `/assignment-help` command.
5. `testprep` skill + `/testprep` command.
6. `book-summary` skill + `/book-summary` command + `_normalize_study_book_summaries` ingest rule + live run.

---

## 11. Open items

1. **Book-title extraction is fuzzy.** The `book-summary` mention scan relies on the skill's judgement over transcript text, not a parser — a lecturer saying "read Christensen's book" should surface "The Innovator's Dilemma" or at least "Christensen — (title?)". Acceptable: the skill lists best-guess titles + authors for the user to confirm before uploading.
2. **`assignment-help` on group assignments:** `isGroup` assignments — the skeleton is still individual-useful (your section of the group work). No special handling; the skill notes it's a group submission.
3. **`study/` artifact staleness:** an artifact's `sourceHashes` let a future check flag "the assignment changed since this help was generated", but C does not build that check — `brain_status` just counts artifacts. A `study-stale` report is a possible later addition.
4. **`testprep` answer quality with a thin corpus:** early in a term a course may have 2-3 sessions of material. The skill should generate fewer questions and say so rather than pad.
