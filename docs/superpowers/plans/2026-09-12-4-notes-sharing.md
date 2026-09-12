# Notes Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A student can opt in to share a self-note (upload to
`notes/<student-name>/` in the shared Drive folder); every classmate's
`brain_query` results then include everyone's shared notes, each row
attributed to who wrote it.

**Architecture:** A small per-student identity (`student_identity.py`, a
name string in `.env` — never shared, used only as the Drive subfolder name
and as attribution metadata). A new `drive_sync.list_shared()` primitive
(extending the Build-order item 1 module — not present in that plan's
scope, added here since notes sharing is the first consumer that needs
"list everything under a prefix" rather than "read one known file"). A
`build_index` extension that pulls every classmate's shared note and
indexes it alongside the local corpus with a `sharedBy` column.

**Tech Stack:** Python (`scraper/`).

**Spec:** `docs/superpowers/specs/2026-09-12-collaborative-multi-student-design.md`
(section E). Depends on Build-order item 1. Implements Build-order item 4
(notes half).

## Global Constraints

- Sharing a note is ALWAYS an explicit action — nothing in `ingest.py`'s
  existing self-note normalization (`_normalize_inbox`) auto-uploads.
  `_normalize_inbox` is not modified by this plan at all.
- Attribution is never stripped — every shared-note search hit carries
  `sharedBy: <student-name>`, sourced from the Drive subfolder name the
  note was found under, not from a separately-maintained mapping that could
  drift.
- A student's own local notes are never double-counted: when indexing
  classmates' shared notes, this plan's index-merge step SKIPS the current
  student's own subfolder (`notes/<my-name>/`) — their own notes are
  already in the local corpus via `_normalize_inbox`.

---

### Task 1: `student_identity.py` + `drive_sync.list_shared`

**Files:**

- Create: `scraper/student_identity.py`
- Modify: `scraper/drive_sync.py` (add `list_shared`)
- Test: `scraper/tests/test_student_identity.py`,
  `scraper/tests/test_drive_sync.py` (extend)

**Interfaces:**

- Produces: `student_identity.my_name() -> str` (reads `.env`'s
  `ARES_BRAIN_STUDENT_NAME`; raises `ValueError` with a clear setup message
  if unset — this is a required piece of local config, not optional).
- Produces: `drive_sync.list_shared(slug: str, prefix: str) -> list[dict]`
  — each item `{"subfolder": str, "name": str, "content": bytes}`, one per
  file found under `<course-folder>/<prefix>/*/*`.

- [ ] **Step 1: Write the failing tests**

```python
# scraper/tests/test_student_identity.py
import pytest
import student_identity as si


def test_my_name_from_env(monkeypatch):
    monkeypatch.setenv("ARES_BRAIN_STUDENT_NAME", "Priya")
    assert si.my_name() == "Priya"


def test_my_name_missing_raises(monkeypatch):
    monkeypatch.delenv("ARES_BRAIN_STUDENT_NAME", raising=False)
    with pytest.raises(ValueError, match="ARES_BRAIN_STUDENT_NAME"):
        si.my_name()
```

```python
# scraper/tests/test_drive_sync.py — new case
from unittest.mock import MagicMock
import drive_sync as ds


def test_list_shared_excludes_named_subfolder(monkeypatch):
    monkeypatch.setattr(ds, "folder_id_for_course", lambda slug: "FOLDER123")
    mock_svc = MagicMock()
    mock_svc.files().list().execute.return_value = {
        "files": [
            {"id": "F1", "name": "notes__priya__n1.md"},
            {"id": "F2", "name": "notes__arjun__n2.md"},
        ]
    }
    mock_svc.files().get_media().execute.side_effect = [b"priya's note", b"arjun's note"]
    monkeypatch.setattr(ds, "_drive_service", lambda: mock_svc)
    results = ds.list_shared("ai-101", "notes", exclude_subfolder="priya")
    assert len(results) == 1
    assert results[0]["subfolder"] == "arjun"
    assert results[0]["content"] == b"arjun's note"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd scraper && uv run pytest tests/test_student_identity.py tests/test_drive_sync.py -k "list_shared or my_name" -v`
Expected: FAIL — neither exists yet

- [ ] **Step 3: Write `student_identity.py`**

```python
"""Per-student local identity — used only as a Drive subfolder name and
attribution label. Never uploaded/shared itself."""
import os


def my_name() -> str:
    name = os.environ.get("ARES_BRAIN_STUDENT_NAME", "").strip()
    if not name:
        raise ValueError(
            "ARES_BRAIN_STUDENT_NAME is not set in .env — set it to your name "
            "before sharing notes/testprep (used as your shared-folder name)."
        )
    return name
```

- [ ] **Step 4: Add `list_shared` to `drive_sync.py`**

The filenames this module writes are flattened (`subpath.replace("/",
"__")`), so `notes/priya/n1.md` is stored as `notes__priya__n1.md`. Listing
means: list everything in the folder whose name starts with `f"{prefix}__"`,
parse the subfolder back out, skip the excluded one, download the rest.

```python
def list_shared(slug: str, prefix: str, exclude_subfolder: str | None = None) -> list[dict]:
    folder_id = folder_id_for_course(slug)
    if not folder_id:
        return []
    svc = _drive_service()
    if svc is None:
        return []
    q = f"'{folder_id}' in parents and trashed = false"
    resp = svc.files().list(q=q, fields="files(id, name)").execute()
    out = []
    for f in resp.get("files") or []:
        parts = f["name"].split("__", 2)
        if len(parts) != 3 or parts[0] != prefix:
            continue
        subfolder, name = parts[1], parts[2]
        if exclude_subfolder and subfolder == exclude_subfolder:
            continue
        content = svc.files().get_media(fileId=f["id"]).execute()
        out.append({"subfolder": subfolder, "name": name, "content": content})
    return out
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd scraper && uv run pytest tests/test_student_identity.py tests/test_drive_sync.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add scraper/student_identity.py scraper/drive_sync.py scraper/tests/test_student_identity.py scraper/tests/test_drive_sync.py
git commit -m "feat: add student identity + drive_sync.list_shared for notes sharing"
```

---

### Task 2: "Share this note" — CLI + upload

**Files:**

- Modify: `scraper/lms_scrape.py` (new subcommand)
- Test: extend the CLI test file used in Build-order item 1/3

**Interfaces:**

- Produces: CLI `share-note --course <slug> --path <normalized-relative-path> --json`
  → uploads that local normalized self-note to `notes/<my-name>/<basename>`,
  prints `{"ok": true, "link": "<shareable-link>"}` or `{"ok": false, "error": ...}`.

- [ ] **Step 1: Write the failing test**

```python
def test_share_note_uploads_and_returns_link(tmp_path, monkeypatch):
    # ... fixture: a real normalized self-note file on disk ...
    with patch("drive_sync.upload_shared", return_value="https://drive.google.com/x") as mock_up:
        import lms_scrape
        result = lms_scrape.run(["share-note", "--course", "ai-101",
                                  "--path", "normalized/self-note-x.md", "--json"])
        assert result == {"ok": True, "link": "https://drive.google.com/x"}
        subpath_arg = mock_up.call_args.args[1]
        assert subpath_arg.startswith("notes/")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd scraper && uv run pytest tests/test_lms_scrape_cli.py -k share_note -v`
Expected: FAIL — subcommand doesn't exist

- [ ] **Step 3: Add the subcommand**

```python
sn = sub.add_parser("share-note")
sn.add_argument("--course", required=True)
sn.add_argument("--path", required=True)
sn.add_argument("--json", action="store_true")
```

```python
if args.cmd == "share-note":
    import drive_sync as _ds, student_identity as _si
    from pathlib import Path as _P
    local = course_dir(args.course) / args.path
    if not local.exists():
        result = {"ok": False, "error": f"{args.path} not found"}
    else:
        name = _si.my_name()
        link = _ds.upload_shared(args.course, f"notes/{name}/{local.name}", local)
        result = {"ok": link is not None, "link": link}
    print(json.dumps(result) if args.json else json.dumps(result, indent=1))
    return result
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd scraper && uv run pytest tests/test_lms_scrape_cli.py -k share_note -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scraper/lms_scrape.py scraper/tests/test_lms_scrape_cli.py
git commit -m "feat: add share-note CLI subcommand"
```

---

### Task 3: `build_index` merges shared notes with attribution

**Files:**

- Modify: `scraper/brain.py:239-277` (`build_index`), `:301-365` (`query`)
- Test: `scraper/tests/test_brain.py` (extend)

**Interfaces:**

- Consumes: `drive_sync.list_shared(slug, "notes", exclude_subfolder=student_identity.my_name())`
- Produces: `build_index` writes a `sharedBy` column (empty string for
  local docs); `query(...)` results gain a `sharedBy` key (empty string
  when not a shared doc).

- [ ] **Step 1: Write the failing tests**

```python
# scraper/tests/test_brain.py — new cases
from unittest.mock import patch
import brain


def test_build_index_includes_shared_notes_with_attribution(tmp_path, monkeypatch):
    # ... existing corpus fixture with zero self-notes locally ...
    shared = [{"subfolder": "arjun", "name": "n1.md",
              "content": b"---\ntype: self-note\ntitle: Arjun's note\n---\nsome content"}]
    with patch("brain.drive_sync.list_shared", return_value=shared), \
         patch("brain.student_identity.my_name", return_value="priya"):
        brain.build_index("ai-101", force=True)
    results = brain.query("ai-101", text="content")
    assert any(r.get("sharedBy") == "arjun" for r in results)


def test_query_local_docs_have_empty_sharedby(tmp_path, monkeypatch):
    # ... existing corpus fixture with one local material ...
    with patch("brain.drive_sync.list_shared", return_value=[]):
        brain.build_index("ai-101", force=True)
    results = brain.query("ai-101")
    assert all(r.get("sharedBy", "") == "" for r in results)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd scraper && uv run pytest tests/test_brain.py -k shared -v`
Expected: FAIL — no `sharedBy` column/behavior yet

- [ ] **Step 3: Update the FTS schema and insert/query code**

In `build_index` (`brain.py`), change the `CREATE VIRTUAL TABLE` to add the
column, and after inserting local `files`, insert the shared notes too:

```python
    con.execute(
        "CREATE VIRTUAL TABLE docs USING fts5("
        "path UNINDEXED, course UNINDEXED, type UNINDEXED, "
        "session UNINDEXED, due UNINDEXED, title, body, "
        "sharedBy UNINDEXED, "
        "tokenize = 'porter unicode61')"
    )
    corpus_bytes = 0
    for p in files:
        text = p.read_text(errors="replace")
        fm, body = parse_frontmatter(text)
        corpus_bytes += len(body.encode())
        con.execute(
            "INSERT INTO docs (path, course, type, session, due, title, body, sharedBy) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, '')",
            (f"normalized/{p.name}", fm.get("course", ""), fm.get("type", ""),
             str(fm.get("session", "")), fm.get("due", ""),
             fm.get("title", p.stem), body),
        )

    try:
        import drive_sync, student_identity
        shared = drive_sync.list_shared(slug, "notes", exclude_subfolder=student_identity.my_name())
    except Exception:  # noqa: BLE001 — sharing is best-effort, never blocks indexing
        shared = []
    for item in shared:
        fm, body = parse_frontmatter(item["content"].decode(errors="replace"))
        con.execute(
            "INSERT INTO docs (path, course, type, session, due, title, body, sharedBy) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (f"shared/notes/{item['subfolder']}/{item['name']}", fm.get("course", ""),
             fm.get("type", "self-note"), str(fm.get("session", "")), fm.get("due", ""),
             fm.get("title", item["name"]), body, item["subfolder"]),
        )
```

Then in `query()`'s row-building (wherever it currently builds the result
dict per row — `brain.py:301-365`), add `"sharedBy": row["sharedBy"]` (or
positional equivalent, matching however this function currently reads FTS
columns) to the returned dict.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd scraper && uv run pytest tests/test_brain.py -v`
Expected: all pass, zero regressions in existing brain.py tests (91+ prior
tests per this repo's history — see `courses/../ares-brain-project.md`)

- [ ] **Step 5: Commit**

```bash
git add scraper/brain.py scraper/tests/test_brain.py
git commit -m "feat: merge classmates' shared notes into the local search index, attributed"
```
