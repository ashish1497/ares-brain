import json
from pathlib import Path

import pytest

import ingest


@pytest.fixture(autouse=True)
def _clear_names():
    ingest._name_owner.clear()
    yield


def test_write_normalized_frontmatter(home):
    p = ingest.write_normalized(
        "course-one", type_="assignment", source="api:assignment:a1",
        title="Session 1 Assignment", course_name="Course One",
        body="Do the thing.", due="2026-08-29T11:30:00.000Z", session=1)
    assert p == home / "courses" / "course-one" / "normalized" / "assignment-session-1-assignment.md"
    text = p.read_text()
    assert text.startswith("---\n")
    assert "type: assignment" in text
    assert 'due: "2026-08-29T11:30:00.000Z"' in text
    assert "session: 1" in text
    assert "bodyHash: " in text
    assert text.rstrip().endswith("Do the thing.")


def test_write_normalized_omits_absent_optional_keys(home):
    p = ingest.write_normalized("c", type_="material", source="s", title="T",
                                course_name="C", body="b")
    text = p.read_text()
    assert "due:" not in text and "session:" not in text and "recordedOn:" not in text


def test_stable_name_collision_gets_suffix(home):
    a = ingest.write_normalized("c", type_="material", source="s1", title="Same",
                                course_name="C", body="one")
    b = ingest.write_normalized("c", type_="material", source="s2", title="Same",
                                course_name="C", body="two")
    assert a.name == "material-same.md"
    assert b.name == "material-same-2.md"


def test_manifest_roundtrip(home):
    assert ingest._load_manifest("c") == {"sources": {}, "ingestedAt": None}
    ingest._save_manifest("c", {"sources": {"k": {"hash": "h", "outPath": "normalized/x.md"}},
                                "ingestedAt": "2026-09-02T00:00:00Z"})
    m = ingest._load_manifest("c")
    assert m["sources"]["k"]["hash"] == "h"


def test_ensure_inbox_skeleton(home):
    ingest.ensure_inbox_skeleton([{"id": "c1", "name": "Course One", "slug": "course-one"}])
    base = home / "courses" / "course-one" / "inbox"
    assert (base / "notes").is_dir() and (base / "recordings").is_dir() and (base / "books").is_dir()
    assert (home / "courses" / "inbox" / "_unsorted").is_dir()


def _seed_course(home, slug="course-one", name="Course One"):
    raw = home / "courses" / slug / "raw"
    raw.mkdir(parents=True)
    return raw


def test_normalize_material_text_kind(home):
    raw = _seed_course(home)
    (raw / "materials.json").write_text(json.dumps([
        {"id": "m1", "kind": "text", "title": "Outline note", "category": "outline",
         "session": 1, "content": '<p>Read <a href="http://x/y">this</a>.</p>',
         "localPath": None}]))
    ingest._name_owner.clear()
    out = ingest._normalize_materials("course-one", "Course One", {})
    assert len(out) == 1
    src, h, path, was_written = out[0]
    assert was_written is True
    text = path.read_text()
    assert "[this](http://x/y)" in text
    assert "type: material" in text and "session: 1" in text


def test_normalize_material_file_kind_reads_from_raw_files(home):
    import shutil
    from pathlib import Path as _P
    raw = _seed_course(home)
    (raw / "files").mkdir()
    fix = _P(__file__).parent / "fixtures" / "scrubbed" / "sample.pdf"
    shutil.copy(fix, raw / "files" / "f1.pdf")
    (raw / "materials.json").write_text(json.dumps([
        {"id": "m1", "kind": "file", "title": "Slide deck", "fileType": "pdf",
         "allowDownload": True, "localPath": "files/f1.pdf"}]))
    ingest._name_owner.clear()
    out = ingest._normalize_materials("course-one", "Course One", {})
    text = out[0][2].read_text()
    assert "Hello from the sample PDF" in text
    assert "unextractable" not in text


def test_normalize_assignment_has_due_and_facts(home):
    raw = _seed_course(home)
    (raw / "assignments.json").write_text(json.dumps([
        {"id": "a1", "title": "S1 Assignment", "instructions": "<p>Do it.</p>",
         "dueAt": "2026-08-29T11:30:00.000Z", "cutoffDate": "2026-08-29T18:00:00.000Z",
         "submissionType": "file", "isGroup": True}]))
    ingest._name_owner.clear()
    out = ingest._normalize_assignments("course-one", "Course One", {})
    text = out[0][2].read_text()
    assert 'due: "2026-08-29T11:30:00.000Z"' in text
    assert "Do it." in text
    assert "Submission: file" in text and "Group: yes" in text


def test_step_ingest_skips_unchanged_and_deletes_orphans(home):
    raw = _seed_course(home)
    (raw / "materials.json").write_text(json.dumps([
        {"id": "m1", "kind": "text", "title": "Note A", "content": "<p>a</p>", "localPath": None}]))
    (raw / "assignments.json").write_text("[]")
    (raw / "recordings.json").write_text("[]")
    index = [{"id": "c1", "name": "Course One", "slug": "course-one"}]

    ingest._name_owner.clear()
    r1 = ingest.step_ingest(index)
    assert r1["perCourse"]["course-one"]["normalized"] == 1
    note = home / "courses" / "course-one" / "normalized" / "material-note-a.md"
    mtime1 = note.stat().st_mtime

    ingest._name_owner.clear()
    r2 = ingest.step_ingest(index)
    assert r2["perCourse"]["course-one"]["normalized"] == 0
    assert r2["perCourse"]["course-one"]["skipped"] == 1
    assert note.stat().st_mtime == mtime1     # not rewritten

    # remove the source -> orphan deleted
    (raw / "materials.json").write_text("[]")
    ingest._name_owner.clear()
    r3 = ingest.step_ingest(index)
    assert r3["perCourse"]["course-one"]["orphansDeleted"] == 1
    assert not note.exists()


def test_malformed_material_does_not_lose_others(home):
    raw = _seed_course(home)
    (raw / "materials.json").write_text(json.dumps([
        {"id": "good", "kind": "text", "title": "Good", "content": "<p>a</p>"},
        {"kind": "text", "title": "NoId"}]))
    (raw / "assignments.json").write_text("[]")
    index = [{"id": "c1", "name": "Course One", "slug": "course-one"}]

    ingest._name_owner.clear()
    r = ingest.step_ingest(index)
    assert (home / "courses" / "course-one" / "normalized" / "material-good.md").exists()
    assert r["errors"]


def test_normalizer_error_prevents_orphan_delete(home):
    raw = _seed_course(home)
    (raw / "materials.json").write_text(json.dumps([
        {"id": "old", "kind": "text", "title": "Old", "content": "<p>a</p>"}]))
    (raw / "assignments.json").write_text("[]")
    index = [{"id": "c1", "name": "Course One", "slug": "course-one"}]

    ingest._name_owner.clear()
    ingest.step_ingest(index)
    old_note = home / "courses" / "course-one" / "normalized" / "material-old.md"
    assert old_note.exists()

    # source "old" is gone; only a malformed NEW record remains
    (raw / "materials.json").write_text(json.dumps([{"kind": "text", "title": "Broken"}]))
    ingest._name_owner.clear()
    r = ingest.step_ingest(index)
    assert r["errors"]
    assert r["perCourse"]["course-one"]["orphansDeleted"] == 0
    assert old_note.exists()
    manifest = ingest._load_manifest("course-one")
    assert "api:material:old" in manifest["sources"]


def test_normalize_outline_via_gsheet(home, monkeypatch):
    raw = _seed_course(home)
    (raw / "topics.json").write_text(json.dumps([{"id": "t1", "type": "outline"}]))
    (raw / "materials.json").write_text(json.dumps([
        {"id": "mo", "kind": "text", "title": "Outline", "category": "outline",
         "topicId": "t1", "localPath": None,
         "content": '<a href="https://docs.google.com/spreadsheets/d/SHEET/edit">Outline</a>'}]))
    (raw / "assignments.json").write_text("[]")
    (raw / "recordings.json").write_text("[]")
    import gsheet
    monkeypatch.setattr(gsheet, "fetch_csv", lambda sid: "Session,Topic\n1,Intro\n")
    ingest._name_owner.clear()
    ingest.step_ingest([{"id": "c1", "name": "Course One", "slug": "course-one"}])
    outline = home / "courses" / "course-one" / "normalized" / "outline-outline.md"
    assert outline.exists()
    assert "| Session | Topic |" in outline.read_text()
    assert not (home / "courses" / "course-one" / "normalized" / "material-outline.md").exists()


def test_normalize_outline_unfetched_drops_message(home, monkeypatch):
    raw = _seed_course(home)
    (raw / "topics.json").write_text(json.dumps([{"id": "t1", "type": "outline"}]))
    (raw / "materials.json").write_text(json.dumps([
        {"id": "mo", "kind": "text", "title": "Outline", "topicId": "t1", "localPath": None,
         "content": '<a href="https://docs.google.com/spreadsheets/d/SHEET/edit">O</a>'}]))
    (raw / "assignments.json").write_text("[]")
    import gsheet
    monkeypatch.setattr(gsheet, "fetch_csv", lambda sid: None)
    ingest._name_owner.clear()
    ingest.step_ingest([{"id": "c1", "name": "Course One", "slug": "course-one"}])
    outline = home / "courses" / "course-one" / "normalized" / "outline-outline.md"
    assert outline.exists() and "could not be fetched" in outline.read_text()


def test_normalize_self_note_from_inbox(home):
    _seed_course(home)
    notes = home / "courses" / "course-one" / "inbox" / "notes"
    notes.mkdir(parents=True)
    (notes / "my-thoughts.md").write_text("Class was about pricing.")
    for f in ("materials.json", "assignments.json", "recordings.json"):
        (home / "courses" / "course-one" / "raw" / f).write_text("[]")
    ingest._name_owner.clear()
    ingest.step_ingest([{"id": "c1", "name": "Course One", "slug": "course-one"}])
    note = home / "courses" / "course-one" / "normalized" / "self-note-my-thoughts.md"
    assert note.exists() and "pricing" in note.read_text()
    assert "type: self-note" in note.read_text()


def test_normalize_sessions_from_events(home):
    (home / "courses" / "_events.json").write_text(json.dumps({
        "window": {"from": "x", "to": "y"},
        "events": [
            {"id": "e1", "eventType": "session", "title": "Frameworks S1",
             "startAt": "2026-08-20T04:00:00Z", "endAt": "2026-08-20T05:30:00Z",
             "timezone": "Asia/Kolkata", "instructorName": "Prof X",
             "courseName": "Course One", "courseSlug": "course-one"},
            {"id": "e2", "eventType": "event", "title": "Building Time",
             "courseSlug": "course-one"}]}))
    _seed_course(home)
    for f in ("materials.json", "assignments.json", "recordings.json"):
        (home / "courses" / "course-one" / "raw" / f).write_text("[]")
    ingest._name_owner.clear()
    ingest.step_ingest([{"id": "c1", "name": "Course One", "slug": "course-one"}])
    ndir = home / "courses" / "course-one" / "normalized"
    files = [p.name for p in ndir.glob("session-*.md")]
    assert files == ["session-frameworks-s1.md"]
    assert "Instructor: Prof X" in (ndir / "session-frameworks-s1.md").read_text()


def test_normalize_announcements_program_and_per_course(home):
    (home / "courses" / "_announcements.json").write_text(json.dumps([
        {"id": "p1", "title": "Welcome", "body": "<p>Hello all</p>", "courseSlug": "course-one"}]))
    raw = _seed_course(home)
    for f in ("materials.json", "assignments.json", "recordings.json"):
        (raw / f).write_text("[]")
    (raw / "announcements.json").write_text(json.dumps([
        {"id": "a1", "title": "Room change", "body": "<p>Now in B2</p>"}]))
    ingest._name_owner.clear()
    ingest.step_ingest([{"id": "c1", "name": "Course One", "slug": "course-one"}])
    ndir = home / "courses" / "course-one" / "normalized"
    names = sorted(p.name for p in ndir.glob("announcement-*.md"))
    assert names == ["announcement-room-change.md", "announcement-welcome.md"]
    assert "Now in B2" in (ndir / "announcement-room-change.md").read_text()


def test_sessions_idempotent(home):
    (home / "courses" / "_events.json").write_text(json.dumps({
        "window": {"from": "x", "to": "y"},
        "events": [
            {"id": "e1", "eventType": "session", "title": "Frameworks S1",
             "startAt": "2026-08-20T04:00:00Z", "endAt": "2026-08-20T05:30:00Z",
             "timezone": "Asia/Kolkata", "instructorName": "Prof X",
             "courseName": "Course One", "courseSlug": "course-one"}]}))
    raw = _seed_course(home)
    for f in ("materials.json", "assignments.json", "recordings.json"):
        (raw / f).write_text("[]")
    index = [{"id": "c1", "name": "Course One", "slug": "course-one"}]

    ingest._name_owner.clear()
    r1 = ingest.step_ingest(index)
    s = home / "courses" / "course-one" / "normalized" / "session-frameworks-s1.md"
    assert s.exists()
    mtime1 = s.stat().st_mtime
    assert r1["perCourse"]["course-one"]["normalized"] == 1

    ingest._name_owner.clear()
    r2 = ingest.step_ingest(index)
    assert s.stat().st_mtime == mtime1
    assert r2["perCourse"]["course-one"]["normalized"] == 0
    assert r2["perCourse"]["course-one"]["skipped"] >= 1


def test_normalize_book_from_inbox(home):
    import shutil
    _seed_course(home)
    books = home / "courses" / "course-one" / "inbox" / "books"
    books.mkdir(parents=True)
    shutil.copy(Path(__file__).parent / "fixtures" / "scrubbed" / "sample.pdf",
                books / "sample.pdf")
    for f in ("materials.json", "assignments.json", "recordings.json"):
        (home / "courses" / "course-one" / "raw" / f).write_text("[]")
    ingest._name_owner.clear()
    ingest.step_ingest([{"id": "c1", "name": "Course One", "slug": "course-one"}])
    book = home / "courses" / "course-one" / "normalized" / "book-sample.md"
    assert book.exists()
    text = book.read_text()
    assert "type: book" in text
    assert len(text.split("---", 2)[-1].strip()) > 0


def test_epub_book_silently_skipped(home):
    _seed_course(home)
    books = home / "courses" / "course-one" / "inbox" / "books"
    books.mkdir(parents=True)
    (books / "book.epub").write_bytes(b"")
    for f in ("materials.json", "assignments.json", "recordings.json"):
        (home / "courses" / "course-one" / "raw" / f).write_text("[]")
    ingest._name_owner.clear()
    r = ingest.step_ingest([{"id": "c1", "name": "Course One", "slug": "course-one"}])
    assert not (home / "courses" / "course-one" / "normalized" / "book-book.md").exists()
    assert not any("book.epub" in e or "epub" in e for e in r["errors"])


# ---------------------------------------------------------------------------
# A-ingest final review fixes
# ---------------------------------------------------------------------------

import yaml


def _mat_index():
    return [{"id": "c1", "name": "Course One", "slug": "course-one"}]


def test_cross_run_same_title_no_clobber(home):
    raw = _seed_course(home)
    (raw / "assignments.json").write_text("[]")
    (raw / "recordings.json").write_text("[]")

    def write_mats(m2_body):
        (raw / "materials.json").write_text(json.dumps([
            {"id": "m1", "kind": "text", "title": "Same", "content": "<p>one body</p>"},
            {"id": "m2", "kind": "text", "title": "Same", "content": m2_body}]))

    write_mats("<p>two body</p>")
    ingest._name_owner.clear()
    ingest.step_ingest(_mat_index())
    ndir = home / "courses" / "course-one" / "normalized"
    f1, f2 = ndir / "material-same.md", ndir / "material-same-2.md"
    assert "one body" in f1.read_text()
    assert "two body" in f2.read_text()

    # mutate ONLY m2
    write_mats("<p>two body CHANGED</p>")
    ingest._name_owner.clear()
    ingest.step_ingest(_mat_index())
    assert "one body" in f1.read_text()
    assert "one body CHANGED" not in f1.read_text()
    assert "two body CHANGED" in f2.read_text()

    manifest = ingest._load_manifest("course-one")
    paths = {v["outPath"] for k, v in manifest["sources"].items()
             if k.startswith("api:material:")}
    assert paths == {"normalized/material-same.md", "normalized/material-same-2.md"}


def test_frontmatter_is_valid_yaml(home):
    p = ingest.write_normalized(
        "course-one", type_="material", source="api:material:x",
        title='Session 1: "Intro" — #1', course_name="Course #1: Frameworks",
        body="body", due="2026-01-02T00:00:00Z")
    text = p.read_text()
    fm = text.split("---\n", 2)[1]
    loaded = yaml.safe_load(fm)
    assert loaded["title"] == 'Session 1: "Intro" — #1'
    assert loaded["course"] == "Course #1: Frameworks"
    assert loaded["due"] == "2026-01-02T00:00:00Z"


def test_outline_topic_non_sheet_material_preserved(home, monkeypatch):
    raw = _seed_course(home)
    (raw / "topics.json").write_text(json.dumps([{"id": "t1", "type": "outline"}]))
    (raw / "materials.json").write_text(json.dumps([
        {"id": "mo", "kind": "text", "title": "Outline", "topicId": "t1",
         "content": "<p>See the LMS</p>"}]))
    (raw / "assignments.json").write_text("[]")
    (raw / "recordings.json").write_text("[]")
    ingest._name_owner.clear()
    ingest.step_ingest(_mat_index())
    ndir = home / "courses" / "course-one" / "normalized"
    assert not list(ndir.glob("outline-*.md"))
    mat = ndir / "material-outline.md"
    assert mat.exists() and "See the LMS" in mat.read_text()


def test_normalize_material_link_kind(home):
    assert ingest._material_body({"kind": "link", "url": "http://x/y"}, "s") == "> http://x/y"
    assert ingest._material_body({"kind": "link"}, "s") == "> (no url)"


def test_material_pptx_through_step_ingest(home):
    import shutil
    raw = _seed_course(home)
    (raw / "files").mkdir()
    shutil.copy(Path(__file__).parent / "fixtures" / "scrubbed" / "sample.pptx",
                raw / "files" / "s.pptx")
    (raw / "materials.json").write_text(json.dumps([
        {"id": "m1", "kind": "file", "title": "Deck", "localPath": "files/s.pptx"}]))
    (raw / "assignments.json").write_text("[]")
    (raw / "recordings.json").write_text("[]")
    ingest._name_owner.clear()
    ingest.step_ingest(_mat_index())
    text = (home / "courses" / "course-one" / "normalized" / "material-deck.md").read_text()
    assert "Slide one title" in text


def test_course_filter_isolates_other_courses(home):
    for slug, name in (("course-a", "Course A"), ("course-b", "Course B")):
        raw = home / "courses" / slug / "raw"
        raw.mkdir(parents=True)
        (raw / "materials.json").write_text(json.dumps([
            {"id": f"{slug}-m1", "kind": "text", "title": "Note", "content": "<p>x</p>"}]))
        (raw / "assignments.json").write_text("[]")
        (raw / "recordings.json").write_text("[]")
    index = [{"id": "a", "name": "Course A", "slug": "course-a"},
             {"id": "b", "name": "Course B", "slug": "course-b"}]
    ingest._name_owner.clear()
    ingest.step_ingest(index)
    bdir = home / "courses" / "course-b" / "normalized"
    bmani = bdir / "_ingest.json"
    before_mtime = bmani.stat().st_mtime
    before_files = sorted(p.name for p in bdir.iterdir())

    ingest._name_owner.clear()
    ingest.step_ingest(index, "course-a")
    assert bmani.stat().st_mtime == before_mtime
    assert sorted(p.name for p in bdir.iterdir()) == before_files


def test_normalize_transcripts_quoted_frontmatter_split(home):
    raw = _seed_course(home)
    for f in ("materials.json", "assignments.json", "recordings.json"):
        (raw / f).write_text("[]")
    tdir = home / "courses" / "course-one" / "transcripts"
    tdir.mkdir(parents=True)
    (tdir / "rec1.md").write_text(
        '---\ntype: transcript\ntitle: "S1: intro"\ncourse: "C"\n---\n'
        "[00:00:00] hello world\n")
    ingest._name_owner.clear()
    ingest.step_ingest(_mat_index())
    out = home / "courses" / "course-one" / "normalized" / "transcript-rec1.md"
    body = out.read_text().split("---\n", 2)[-1]
    assert "hello world" in body
    assert "type: transcript" not in body


def test_normalize_transcripts_unsplittable_frontmatter_keeps_body(home):
    raw = _seed_course(home)
    for f in ("materials.json", "assignments.json", "recordings.json"):
        (raw / f).write_text("[]")
    tdir = home / "courses" / "course-one" / "transcripts"
    tdir.mkdir(parents=True)
    (tdir / "rec2.md").write_text("---\nbroken frontmatter no close\n[00:00:00] kept\n")
    ingest._name_owner.clear()
    r = ingest.step_ingest(_mat_index())
    out = home / "courses" / "course-one" / "normalized" / "transcript-rec2.md"
    assert "kept" in out.read_text()
    assert any("could not split frontmatter" in e for e in r["errors"])


def test_announcement_dedup_and_truncation(home):
    raw = _seed_course(home)
    for f in ("materials.json", "assignments.json", "recordings.json"):
        (raw / f).write_text("[]")
    long_body = "<p>" + ("x" * 3000) + "</p>"
    # same id a1 in per-course AND program batch -> must be written once
    (raw / "announcements.json").write_text(json.dumps([
        {"id": "a1", "title": "Big", "body": long_body}]))
    (home / "courses" / "_announcements.json").write_text(json.dumps([
        {"id": "a1", "title": "Big", "body": long_body, "courseSlug": "course-one"}]))
    ingest._name_owner.clear()
    r = ingest.step_ingest(_mat_index())
    ndir = home / "courses" / "course-one" / "normalized"
    files = list(ndir.glob("announcement-*.md"))
    assert len(files) == 1
    assert r["perCourse"]["course-one"]["normalized"] == 1
    assert files[0].read_text().rstrip().endswith("(truncated)")


def test_stale_format_version_forces_renormalize(home):
    raw = _seed_course(home)
    (raw / "assignments.json").write_text("[]")
    (raw / "recordings.json").write_text("[]")
    (raw / "materials.json").write_text(json.dumps([
        {"id": "m1", "kind": "text", "title": "Note A", "content": "<p>real body</p>"}]))
    ndir = home / "courses" / "course-one" / "normalized"
    ndir.mkdir(parents=True)
    md = ndir / "material-note-a.md"
    md.write_text("---\ntitle: broken\n---\nWRONG STALE CONTENT\n")
    h = ingest._input_hash(json.dumps(
        {"id": "m1", "kind": "text", "title": "Note A", "content": "<p>real body</p>"},
        sort_keys=True))
    (ndir / "_ingest.json").write_text(json.dumps({
        "formatVersion": 1, "ingestedAt": "old",
        "sources": {"api:material:m1": {"hash": h, "outPath": "normalized/material-note-a.md"}}}))

    ingest._name_owner.clear()
    r1 = ingest.step_ingest(_mat_index())
    text = md.read_text()
    assert "real body" in text
    assert "WRONG STALE CONTENT" not in text
    assert 'title: "Note A"' in text
    assert r1["perCourse"]["course-one"]["normalized"] == 1
    assert ingest._load_manifest("course-one")["formatVersion"] == 2

    mtime = md.stat().st_mtime
    ingest._name_owner.clear()
    r2 = ingest.step_ingest(_mat_index())
    assert md.stat().st_mtime == mtime
    assert r2["perCourse"]["course-one"]["normalized"] == 0
    assert r2["perCourse"]["course-one"]["skipped"] == 1


def test_study_book_summary_normalized(home):
    slug = "course-one"
    raw = home / "courses" / slug / "raw"
    raw.mkdir(parents=True)
    for f in ("materials.json", "assignments.json", "recordings.json", "topics.json"):
        (raw / f).write_text("[]")
    study = home / "courses" / slug / "study"
    study.mkdir(parents=True)
    (study / "book-lean-startup-summary.md").write_text(
        "---\ntype: book-summary\ncourse: Course One\ngeneratedAt: 2026-09-03T00:00:00Z\n"
        "sources:\n  - normalized/book-lean-startup.md\nsourceHashes:\n  - h\n---\n"
        "The core loop is build-measure-learn. MVP tests the riskiest assumption.\n")
    import importlib, paths
    importlib.reload(paths); importlib.reload(ingest)
    index = [{"id": "c1", "name": "Course One", "slug": slug}]

    # study/testprep-*.md and study/assignment-*.md must NOT be ingested
    (study / "testprep-20260101.md").write_text(
        "---\ntype: testprep\n---\nnot a book summary\n")
    (study / "assignment-x-20260101.md").write_text(
        "---\ntype: assignment-help\n---\nnot a book summary\n")

    r1 = ingest.step_ingest(index)
    out = home / "courses" / slug / "normalized" / "book-summary-lean-startup.md"
    assert out.exists()
    assert "build-measure-learn" in out.read_text()
    assert "type: book-summary" in out.read_text()
    nd = home / "courses" / slug / "normalized"
    assert not list(nd.glob("*testprep*")) and not list(nd.glob("*assignment-x*"))

    r2 = ingest.step_ingest(index)
    assert r2["perCourse"][slug]["normalized"] == 0  # unchanged -> skipped

    (study / "book-lean-startup-summary.md").unlink()
    ingest.step_ingest(index)
    assert not out.exists()  # orphan-deleted


def test_normalize_materials_shares_each_written_doc(home):
    from unittest.mock import patch
    raw = _seed_course(home)
    (raw / "materials.json").write_text(json.dumps([
        {"id": "m1", "kind": "text", "title": "Outline note", "content": "<p>a</p>",
         "localPath": None}]))
    ingest._name_owner.clear()
    with patch("ingest.drive_sync.write_if_absent") as mock_write:
        out = ingest._normalize_materials("course-one", "Course One", {})
    assert out[0][3] is True  # was_written
    assert mock_write.called
    subpath = mock_write.call_args.args[1]
    assert subpath.startswith("materials/")


def test_normalize_assignments_never_shares(home):
    from unittest.mock import patch
    raw = _seed_course(home)
    (raw / "assignments.json").write_text(json.dumps([
        {"id": "a1", "title": "S1 Assignment", "instructions": "<p>Do it.</p>",
         "dueAt": "2026-08-29T11:30:00.000Z"}]))
    ingest._name_owner.clear()
    with patch("ingest.drive_sync.write_if_absent") as mock_write:
        ingest._normalize_assignments("course-one", "Course One", {})
    mock_write.assert_not_called()


def test_normalize_outline_shares_written_doc(home, monkeypatch):
    from unittest.mock import patch
    raw = _seed_course(home)
    (raw / "topics.json").write_text(json.dumps([{"id": "t1", "type": "outline"}]))
    (raw / "materials.json").write_text(json.dumps([
        {"id": "mo", "kind": "text", "title": "Outline", "category": "outline",
         "topicId": "t1", "localPath": None,
         "content": '<a href="https://docs.google.com/spreadsheets/d/SHEET/edit">Outline</a>'}]))
    import gsheet
    monkeypatch.setattr(gsheet, "fetch_csv", lambda sid: "Session,Topic\n1,Intro\n")
    ingest._name_owner.clear()
    with patch("ingest.drive_sync.write_if_absent") as mock_write:
        results, claimed = ingest._normalize_outline("course-one", "Course One", {})
    assert results[0][3] is True  # was_written
    assert mock_write.called
    args = mock_write.call_args.args
    assert args[0] == "course-one"
    assert args[1].startswith("outline/")


def test_normalize_announcements_shares_with_target_slug(home):
    from unittest.mock import patch
    raw = _seed_course(home)
    (raw / "announcements.json").write_text(json.dumps([
        {"id": "a1", "title": "Room change", "body": "<p>Now in B2</p>"}]))
    index_by_slug = {"course-one": "Course One"}
    ingest._name_owner.clear()
    with patch("ingest.drive_sync.write_if_absent") as mock_write:
        results, failed = ingest._normalize_announcements(index_by_slug, {}, [])
    assert not failed
    assert results["course-one"][0][3] is True  # was_written
    assert mock_write.called
    args = mock_write.call_args.args
    assert args[0] == "course-one"
    assert args[1].startswith("announcements/")
