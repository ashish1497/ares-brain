import shutil
from pathlib import Path
import pytest
import brain

FIX = Path(__file__).parent / "fixtures" / "scrubbed" / "brain_corpus"


@pytest.fixture
def course(home):
    dst = home / "courses" / "course-one"
    dst.mkdir(parents=True)
    shutil.copytree(FIX / "course-one" / "normalized", dst / "normalized")
    import importlib, paths
    importlib.reload(paths); importlib.reload(brain)
    return "course-one"


def test_get_doc_valid(course):
    d = brain.get_doc(course, "book-lean-startup.md")
    assert d["path"] == "normalized/book-lean-startup.md"
    assert d["frontmatter"]["type"] == "book"
    assert "build-measure-learn" in d["body"]


def test_get_doc_accepts_normalized_prefix(course):
    d = brain.get_doc(course, "normalized/book-lean-startup.md")
    assert d is not None and d["path"] == "normalized/book-lean-startup.md"


def test_get_doc_traversal_rejected(course, home):
    (home / "courses" / "course-one" / "secret.md").write_text("nope")
    assert brain.get_doc(course, "../secret.md") is None
    assert brain.get_doc(course, "/etc/hosts") is None
    assert brain.get_doc(course, "x\x00.md") is None


def test_get_doc_missing(course):
    assert brain.get_doc(course, "no-such.md") is None


def test_get_doc_non_md(course, home):
    (home / "courses" / "course-one" / "normalized" / "x.txt").write_text("hi")
    assert brain.get_doc(course, "x.txt") is None


def test_get_doc_no_course(home):
    assert brain.get_doc("ghost", "x.md") is None


def test_get_doc_slug_traversal_rejected(course, home):
    (home / "courses" / "leak.md").write_text("secret")
    assert brain.get_doc("..", "leak.md") is None
    assert brain.get_doc("course-one/../..", "leak.md") is None


def test_get_doc_truncates_long_body(course, home):
    big = "x" * 50000
    (home / "courses" / "course-one" / "normalized" / "big.md").write_text(
        "---\ntype: material\n---\n" + big)
    d = brain.get_doc(course, "big.md", max_bytes=20000)
    assert len(d["body"].encode()) < 25000
    assert "[truncated — 20000 of 50000 bytes]" in d["body"]


def test_get_doc_frontmatter_is_json_safe(course, home):
    import json
    # a real normalized doc has an UNquoted `updatedAt` → yaml yields a datetime
    (home / "courses" / "course-one" / "normalized" / "real.md").write_text(
        "---\ntype: material\ntitle: X\nupdatedAt: 2026-09-06T02:15:36Z\n---\nbody")
    d = brain.get_doc(course, "real.md")
    assert d["frontmatter"]["updatedAt"] == "2026-09-06T02:15:36+00:00"
    json.dumps(d)  # must not raise


def test_get_doc_short_body_unchanged(course):
    full = brain.get_doc(course, "book-lean-startup.md")
    capped = brain.get_doc(course, "book-lean-startup.md", max_bytes=20000)
    assert full["body"] == capped["body"]
    assert "[truncated" not in capped["body"]
