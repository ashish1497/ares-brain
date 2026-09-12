# Testprep Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A student can opt in to share a generated testprep (or any
`study/` artifact) — uploads it to `testprep/<student-name>/` in the shared
Drive folder and returns a shareable link.

**Architecture:** Same shape as Build-order item 4's note-sharing (Task 2
of that plan) — a CLI subcommand that uploads one local file via
`drive_sync.upload_shared`, keyed by `student_identity.my_name()`. This
plan does not touch generation (`write_study_artifact`) at all — testprep
creation stays exactly as it is today; only sharing is new.

**Tech Stack:** Python (`scraper/`).

**Spec:** `docs/superpowers/specs/2026-09-12-collaborative-multi-student-design.md`
(section F). Depends on Build-order item 1 (`drive_sync.upload_shared`) and
item 4's `student_identity.py` (do this plan AFTER item 4, or duplicate
that one small file — recommend after, per the spec's own build order).
Implements Build-order item 4 (testprep half).

## Global Constraints

- Generating a testprep NEVER auto-shares — `write_study_artifact` in
  `brain.py` is not modified by this plan.
- Uses the exact same `student_identity.my_name()` this repo already has
  from the notes-sharing plan — do not introduce a second identity concept.

---

### Task 1: "Share this study artifact" CLI

**Files:**

- Modify: `scraper/lms_scrape.py` (new subcommand)
- Test: extend the existing CLI subcommand test file

**Interfaces:**

- Produces: CLI `share-study --course <slug> --name <artifact-name> --json`
  → uploads `study/<name>.md` to `testprep/<my-name>/<name>.md`, prints
  `{"ok": true, "link": "..."}` or `{"ok": false, "error": "..."}`.

- [ ] **Step 1: Write the failing test**

```python
def test_share_study_uploads_and_returns_link(tmp_path, monkeypatch):
    # ... fixture: a real study/testprep-*.md file on disk for course "ai-101" ...
    with patch("drive_sync.upload_shared", return_value="https://drive.google.com/y") as mock_up:
        import lms_scrape
        result = lms_scrape.run(["share-study", "--course", "ai-101",
                                  "--name", "testprep-20260912", "--json"])
        assert result == {"ok": True, "link": "https://drive.google.com/y"}
        subpath_arg = mock_up.call_args.args[1]
        assert subpath_arg.startswith("testprep/")


def test_share_study_missing_file(tmp_path, monkeypatch):
    import lms_scrape
    result = lms_scrape.run(["share-study", "--course", "ai-101",
                              "--name", "does-not-exist", "--json"])
    assert result["ok"] is False
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd scraper && uv run pytest tests/test_lms_scrape_cli.py -k share_study -v`
Expected: FAIL — subcommand doesn't exist

- [ ] **Step 3: Add the subcommand**

```python
ss = sub.add_parser("share-study")
ss.add_argument("--course", required=True)
ss.add_argument("--name", required=True)
ss.add_argument("--json", action="store_true")
```

```python
if args.cmd == "share-study":
    import drive_sync as _ds, student_identity as _si, brain as _b
    local = _b.study_dir(args.course) / f"{args.name}.md"
    if not local.exists():
        result = {"ok": False, "error": f"study/{args.name}.md not found"}
    else:
        name = _si.my_name()
        link = _ds.upload_shared(args.course, f"testprep/{name}/{local.name}", local)
        result = {"ok": link is not None, "link": link}
    print(json.dumps(result) if args.json else json.dumps(result, indent=1))
    return result
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd scraper && uv run pytest tests/test_lms_scrape_cli.py -k share_study -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scraper/lms_scrape.py scraper/tests/test_lms_scrape_cli.py
git commit -m "feat: add share-study CLI subcommand for opt-in testprep sharing"
```

---

### Task 2: Wire it into the `testprep` skill

**Files:**

- Modify: `skills/ares-brain-testprep/SKILL.md`

- [ ] **Step 1: Add a closing step**

After the existing Step 5 (persist via `brain-write-study`), append:

```markdown
6. Ask the user if they want to share this testprep with classmates. If
   yes, run `cd scraper && uv run python lms_scrape.py share-study --course
<slug> --name <the name used in step 5> --json` and give them the
   printed link. If they say no (or don't answer), don't share it — sharing
   is always opt-in, never automatic.
```

- [ ] **Step 2: Commit**

```bash
git add skills/ares-brain-testprep/SKILL.md
git commit -m "docs: wire opt-in testprep sharing into the testprep skill"
```
