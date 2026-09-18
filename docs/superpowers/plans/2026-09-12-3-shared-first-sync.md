# Shared-First Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transcripts, normalized materials/outline/announcements, and
`GUIDE.md` check the shared Drive folder before doing expensive local work,
and push their result to Drive once done — so the second student in a
cohort to touch a course never re-transcribes or re-synthesizes what the
first student already produced.

**Architecture:** Three integration points, each following the same
shape ("check shared → use it if present, else do the work → share the
result"), wired into the three places that already do this work today:
`transcribe.py._transcribe_course` (the expensive one — whisper/Gemini),
`ingest.py`'s per-type normalizers, and the `ares-brain-brain-build` skill
(GUIDE.md, which is LLM-synthesized by Claude, not by python — so its hook
is two new CLI subcommands the skill calls, not a python-internal change).

**Tech Stack:** Python (`scraper/`).

**Spec:** `docs/superpowers/specs/2026-09-12-collaborative-multi-student-design.md`
(section D). Depends on Build-order item 1 (`drive_sync.py`). Implements
Build-order item 3.

## Global Constraints

- Content-hash comparisons use `ingest._body_hash`/`_input_hash` — the SAME
  hash the local diff-check already computes. This plan does not invent a
  second hashing scheme.
- Attendance/assignments/grades are NEVER touched by this plan — the three
  integration points are all in ingest/transcribe/brain-build, none of
  which handle those doc types.
- Every hook degrades to today's (local-only) behavior when
  `drive_sync.folder_id_for_course(slug)` returns `None` (course not
  configured for sharing yet) — no new hard failure mode for courses
  without a Drive folder set up.

---

### Task 1: Shared-first transcripts

**Files:**

- Modify: `scraper/transcribe.py:314-353` (`_transcribe_course`)
- Test: `scraper/tests/test_transcribe.py` (add cases; existing tests must
  keep passing)

**Interfaces:**

- Consumes: `drive_sync.read_or_none(slug, subpath)`,
  `drive_sync.write_if_absent(slug, subpath, content, content_hash)`
  (Build-order item 1)

- [ ] **Step 1: Write the failing tests**

```python
# scraper/tests/test_transcribe.py — new cases
from unittest.mock import patch
import transcribe


def test_transcribe_course_uses_shared_transcript_when_present(tmp_path, monkeypatch):
    # ... existing fixture setup for a course with one recording (rec id "r1") ...
    shared_content = b"---\ntype: transcript\n---\n[00:00:00] shared content\n"
    with patch("transcribe.drive_sync.read_or_none", return_value=shared_content) as mock_read, \
         patch("transcribe._pull_audio") as mock_pull:
        transcribed, skipped, failed = [], [], []
        transcribe._transcribe_course({"slug": "ai-101"}, transcribed, skipped, failed)
        mock_read.assert_called_with("ai-101", "transcripts/r1.md")
        mock_pull.assert_not_called()  # never touched audio — used the shared copy
        assert "r1" in transcribed


def test_transcribe_course_shares_after_local_transcription(tmp_path, monkeypatch):
    with patch("transcribe.drive_sync.read_or_none", return_value=None), \
         patch("transcribe.drive_sync.write_if_absent") as mock_write, \
         patch("transcribe._pull_audio", return_value=tmp_path / "audio.wav"), \
         patch("transcribe._transcribe_audio", return_value=[(0.0, "hello")]):
        transcribed, skipped, failed = [], [], []
        transcribe._transcribe_course({"slug": "ai-101"}, transcribed, skipped, failed)
        assert mock_write.called
        args = mock_write.call_args.args
        assert args[0] == "ai-101"
        assert args[1] == "transcripts/r1.md"
```

(These illustrate the two new behaviors; adapt to this file's existing
fixture/mocking conventions for `recordings.json` — see the file's current
tests for the exact fixture shape already in use.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd scraper && uv run pytest tests/test_transcribe.py -k shared -v`
Expected: FAIL — `drive_sync` not imported / behavior not implemented

- [ ] **Step 3: Add the shared-first check + share-after to `_transcribe_course`**

In `transcribe.py`, add `import drive_sync` near the top (alongside the
existing imports), then change the per-recording loop body:

```python
        try:
            if not isinstance(rec, dict) or "id" not in rec:
                raise ValueError(f"malformed recording entry: {rec!r}")
            dest = tdir / f"{rec['id']}.md"
            if dest.exists():
                skipped.append(rec["id"])
                continue

            shared = drive_sync.read_or_none(c["slug"], f"transcripts/{rec['id']}.md")
            if shared is not None:
                ensure(tdir)
                dest.write_bytes(shared)
                transcribed.append(rec["id"])
                continue

            with tempfile.TemporaryDirectory() as tmp:
                audio = _pull_audio(rec.get("videoUrl", ""), Path(tmp))
                segs = None
                if audio is not None:
                    try:
                        segs = _transcribe_audio(audio, engine)
                    except Exception:  # noqa: BLE001
                        segs = None
                if segs is None:
                    failed.append({"id": rec["id"], "status": "needs-manual"})
                    failed_here.append({"id": rec["id"], "status": "needs-manual",
                                        "title": rec.get("title")})
                    continue
            _write_transcript(dest, rec, c, segs)
            transcribed.append(rec["id"])
            content = dest.read_bytes()
            drive_sync.write_if_absent(c["slug"], f"transcripts/{rec['id']}.md",
                                       content, ingest._body_hash(content.decode()))
        except Exception as exc:  # noqa: BLE001
            rid = rec["id"] if isinstance(rec, dict) and "id" in rec else "?"
            failed.append({"id": rid, "status": "needs-manual"})
```

Add `import ingest` near the top too (for `_body_hash`) — confirm this
doesn't create an import cycle (`ingest.py` must not import `transcribe.py`
back; check with a quick `grep -n "^import\|^from" ingest.py` before
committing).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd scraper && uv run pytest tests/test_transcribe.py -v`
Expected: all pass, including the two new cases

- [ ] **Step 5: Run the full transcribe suite + import isolation**

Run: `cd scraper && uv run pytest tests/test_transcribe.py tests/test_transcribe_gemini.py -v`
Expected: all pass, zero regressions in the existing Gemini-engine tests

- [ ] **Step 6: Commit**

```bash
git add scraper/transcribe.py scraper/tests/test_transcribe.py
git commit -m "feat: check shared Drive for an existing transcript before re-transcribing"
```

---

### Task 2: Shared-first materials / outline / announcements

**Files:**

- Modify: `scraper/ingest.py` — `_normalize_materials`, `_normalize_outline`,
  `_normalize_announcements` only (share-after; these are cheap enough
  locally that check-before-extract isn't worth the added branching for a
  first cut — see Self-Review Notes)
- Test: `scraper/tests/test_ingest.py` (add cases)

**Interfaces:**

- Consumes: `drive_sync.write_if_absent(slug, subpath, content, content_hash)`

**Important — do NOT hook this inside `_diff_write`.** `_diff_write`
(`ingest.py:125-135`) is the shared helper EVERY normalizer calls,
including `_normalize_assignments` (`ingest.py:163-196`) and `_normalize_inbox`
(self-notes, which must stay local-by-default per Build-order item 4). A
hook inside `_diff_write` itself would share assignments and notes too —
directly violating this repo's "assignments/grades never shared" and
"notes are opt-in" constraints. The share call must live in the three
specific normalizer functions this task names, not in their shared
plumbing.

- [ ] **Step 1: Write the failing test**

```python
# scraper/tests/test_ingest.py — new case
from unittest.mock import patch
import ingest


def test_normalize_materials_shares_each_written_doc(tmp_path, monkeypatch):
    # ... existing fixture: one course with one material that normalizes cleanly ...
    with patch("ingest.drive_sync.write_if_absent") as mock_write:
        ingest._normalize_materials("ai-101", "AI 101", {})
        assert mock_write.called
        subpath = mock_write.call_args.args[1]
        assert subpath.startswith("materials/")


def test_normalize_assignments_never_shares(tmp_path, monkeypatch):
    # ... existing fixture: one course with one assignment ...
    with patch("ingest.drive_sync.write_if_absent") as mock_write:
        ingest._normalize_assignments("ai-101", "AI 101", {})
        mock_write.assert_not_called()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd scraper && uv run pytest tests/test_ingest.py -k "shares_each or never_shares" -v`
Expected: `shares_each` FAILs (no share call yet); `never_shares` already
PASSes (nothing shares today) — that's fine, it's there to catch a future
regression, not to currently prove new behavior.

- [ ] **Step 3: Add a small shared helper, called only from the three
      normalizers that should share**

```python
def _share_if_written(slug: str, prefix: str, path, was_written: bool) -> None:
    """Push a freshly-written normalized doc to the shared Drive folder.
    Only call this from normalizers whose output type is meant to be
    shared (materials/outline/announcements) — never from assignments or
    inbox/self-notes."""
    if not was_written or path is None:
        return
    import drive_sync
    content = path.read_bytes()
    drive_sync.write_if_absent(slug, f"{prefix}/{path.name}", content, _body_hash(content.decode()))
```

Then in `_normalize_materials` (`ingest.py:139-158`), change the
`_diff_write` call site to capture and use the `was_written` flag it
already returns:

```python
            key_, hash_, path, was_written = _diff_write(
                slug, key=key, input_hash=h, old_sources=old_sources,
                write=lambda m=m, key=key, session=session: write_normalized(
                    slug, type_="material", source=key,
                    title=m.get("title") or m["id"], course_name=course_name,
                    body=_material_body(m, slug), session=session))
            _share_if_written(slug, "materials", path, was_written)
            out.append((key_, hash_, path, was_written))
```

Apply the identical pattern (capture the 4-tuple, call
`_share_if_written(slug, "outline", ...)` / `_share_if_written(slug,
"announcements", ...)`) in `_normalize_outline` and
`_normalize_announcements` — match each function's exact current loop
structure; do not touch `_normalize_assignments` or `_normalize_inbox`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd scraper && uv run pytest tests/test_ingest.py -v`
Expected: all pass, including both new cases

- [ ] **Step 5: Full ingest suite + import isolation**

Run: `cd scraper && uv run pytest tests/ -k ingest -v`
Expected: zero regressions across every ingest-related test file

- [ ] **Step 6: Commit**

```bash
git add scraper/ingest.py scraper/tests/test_ingest.py
git commit -m "feat: share normalized materials/outline/announcements to the shared Drive folder"
```

---

### Task 3: Shared-first `GUIDE.md`

**Files:**

- Modify: `scraper/lms_scrape.py` (two new CLI subcommands)
- Modify: `skills/ares-brain-brain-build/SKILL.md`
- Test: `scraper/tests/test_lms_scrape_cli.py` (or wherever CLI subcommand
  tests for `brain-*` already live — match existing convention)

**Interfaces:**

- Produces: CLI `drive-guide-check --course <slug>` → prints the shared
  `GUIDE.md` content as `{"found": true, "body": "..."}` or `{"found":
false}`; CLI `drive-guide-upload --course <slug>` → reads
  `courses/<slug>/brain/GUIDE.md` off disk and shares it, prints `{"ok":
true}` or `{"ok": false, "error": "..."}` (e.g. no Drive folder
  configured for that course, or file missing).

- [ ] **Step 1: Write the failing tests**

```python
# scraper/tests/test_drive_guide_cli.py
from unittest.mock import patch
import subprocess
import sys


def test_drive_guide_check_not_found(tmp_path):
    with patch("drive_sync.read_or_none", return_value=None):
        import lms_scrape
        result = lms_scrape.run(["drive-guide-check", "--course", "ai-101", "--json"])
        assert result == {"found": False}


def test_drive_guide_check_found():
    with patch("drive_sync.read_or_none", return_value=b"# Guide\ncontent"):
        import lms_scrape
        result = lms_scrape.run(["drive-guide-check", "--course", "ai-101", "--json"])
        assert result["found"] is True
        assert "content" in result["body"]
```

(Match whatever this repo's existing CLI-subcommand test pattern actually
is — several `brain-*` subcommands already have equivalent tests to copy
the harness from.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd scraper && uv run pytest tests/test_drive_guide_cli.py -v`
Expected: FAIL — subcommands don't exist

- [ ] **Step 3: Add the two subcommands to `lms_scrape.py`**

```python
dgc = sub.add_parser("drive-guide-check")
dgc.add_argument("--course", required=True)
dgc.add_argument("--json", action="store_true")
dgu = sub.add_parser("drive-guide-upload")
dgu.add_argument("--course", required=True)
dgu.add_argument("--json", action="store_true")
```

Dispatch:

```python
if args.cmd == "drive-guide-check":
    import drive_sync as _ds
    content = _ds.read_or_none(args.course, "guide/GUIDE.md")
    result = {"found": content is not None}
    if content is not None:
        result["body"] = content.decode("utf-8", errors="replace")
    print(json.dumps(result) if args.json else json.dumps(result, indent=1))
    return result
if args.cmd == "drive-guide-upload":
    import drive_sync as _ds, brain as _b
    guide_path = _b.brain_dir(args.course) / "GUIDE.md"
    if not guide_path.exists():
        result = {"ok": False, "error": "GUIDE.md not found locally"}
    else:
        content = guide_path.read_bytes()
        wrote = _ds.write_if_absent(args.course, "guide/GUIDE.md", content,
                                    hashlib.sha256(content).hexdigest())
        result = {"ok": True, "wrote": wrote}
    print(json.dumps(result) if args.json else json.dumps(result, indent=1))
    return result
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd scraper && uv run pytest tests/test_drive_guide_cli.py -v`
Expected: PASS

- [ ] **Step 5: Update the `brain-build` skill**

Insert as the new Step 1 in `skills/ares-brain-brain-build/SKILL.md`
(renumber the rest), before the existing `brain_status` check:

```markdown
1. Run `cd scraper && uv run python lms_scrape.py drive-guide-check --course <slug> --json`.
   If `found: true`, write its `body` straight to `courses/<slug>/brain/GUIDE.md`,
   run `brain-mark-guide` for it, tell the user it was pulled from the shared
   cohort Drive folder (not synthesized), and STOP — don't do the LLM
   synthesis below at all.
```

And append after the existing final step (currently step 6,
`brain-mark-guide`):

```markdown
7. Run `cd scraper && uv run python lms_scrape.py drive-guide-upload --course <slug> --json`
   to share the freshly-built guide with the cohort. If it reports
   `"ok": false` (no Drive folder configured for this course yet), that's
   fine — just don't mention it unless the user asks.
```

- [ ] **Step 6: Commit**

```bash
git add scraper/lms_scrape.py scraper/tests/test_drive_guide_cli.py skills/ares-brain-brain-build/SKILL.md
git commit -m "feat: check-shared / share-after for GUIDE.md via the brain-build skill"
```

---

## Self-Review Notes (for the plan author, not a task)

- Task 2 deliberately does NOT check-before-extract for materials (only
  share-after) — the local extraction work (pdf/docx/pptx text pull) is
  cheap relative to transcription, and adding a check-before-extract branch
  for every material type roughly doubles Task 2's surface for a much
  smaller payoff than Task 1's. If this trade-off turns out wrong in
  practice (e.g. a course with huge PDFs), a follow-up plan can add it —
  flagging here rather than silently deciding it for the whole project.
- Task 1's `dest.write_bytes(shared)` uses `ensure(tdir)` from `paths.py` —
  confirm `transcribe.py` already imports `ensure` (it does, via the same
  import line other functions in the file use) before assuming it's
  available.
