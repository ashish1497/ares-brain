import json
from pathlib import Path
import shutil
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


def test_write_study_artifact_frontmatter(course, home):
    p = brain.write_study_artifact(
        "course-one", "testprep-20260903", type_="testprep",
        course_name="Course One", body="Q1. ...",
        sources=["normalized/book-lean-startup.md", "normalized/ghost.md"])
    assert p == home / "courses" / "course-one" / "study" / "testprep-20260903.md"
    text = p.read_text()
    assert text.startswith("---\n")
    assert 'type: "testprep"' in text and 'course: "Course One"' in text
    assert 'generatedAt: "2026' in text
    assert '- "normalized/book-lean-startup.md"' in text
    assert text.rstrip().endswith("Q1. ...")
    fm, _ = brain.parse_frontmatter(text)
    assert fm["type"] == "testprep"
    assert list(fm) == ["type", "course", "generatedAt", "sources", "sourceHashes"]
    assert len(fm["sourceHashes"]) == len(fm["sources"]) == 2


def test_write_study_artifact_quotes_colon_course_name(course):
    import ingest
    p = brain.write_study_artifact(
        "course-one", "tp1", type_="testprep", course_name="Frameworks: Part 2",
        body="body with a --- line\nmore", sources=[])
    text = p.read_text()
    b_fm, b_body = brain.parse_frontmatter(text)
    i_fm, i_body = ingest.parse_frontmatter(text)
    assert b_fm["course"] == i_fm["course"] == "Frameworks: Part 2"
    assert b_fm["type"] == i_fm["type"] == "testprep"
    assert "--- line" in b_body and "--- line" in i_body
    assert brain.list_study("course-one")[0]["type"] == "testprep"


def test_write_study_artifact_rejects_traversal_name(course, home):
    for bad in ("../x", "a/b", "..", "", ".hidden"):
        with pytest.raises(ValueError):
            brain.write_study_artifact("course-one", bad, type_="testprep",
                                       course_name="C", body="b", sources=[])
    # nothing escaped courses/course-one/study/
    assert not (home / "courses" / "course-one" / "x.md").exists()
    assert not (home / "courses" / "x.md").exists()
    assert not (home / "courses" / "PWNED.md").exists()


def test_write_study_artifact_rejects_bad_slug(home):
    for bad in ("..", "a/b", "c1/../.."):
        with pytest.raises(ValueError):
            brain.write_study_artifact(bad, "n", type_="testprep",
                                       course_name="C", body="b", sources=[])


def test_source_hash_empty_when_not_in_manifest(course, home):
    (home / "courses" / "course-one" / "normalized" / "_ingest.json").write_text(json.dumps(
        {"sources": {"k": {"hash": "H", "outPath": "normalized/book-lean-startup.md"}},
         "ingestedAt": "x", "formatVersion": 2}))
    import importlib
    importlib.reload(brain)
    p = brain.write_study_artifact("course-one", "a", type_="testprep",
                                   course_name="Course One", body="b",
                                   sources=["normalized/book-lean-startup.md", "normalized/nope.md"])
    lines = p.read_text().splitlines()
    hi = lines.index("sourceHashes:")
    assert lines[hi + 1].strip() == '- "H"'
    assert lines[hi + 2].strip() == '- ""'


def test_list_study(course):
    brain.write_study_artifact("course-one", "testprep-1", type_="testprep",
                               course_name="C", body="x", sources=[])
    brain.write_study_artifact("course-one", "assignment-y-1", type_="assignment-help",
                               course_name="C", body="x", sources=[])
    got = {(s["name"], s["type"]) for s in brain.list_study("course-one")}
    assert got == {("testprep-1", "testprep"), ("assignment-y-1", "assignment-help")}


def test_brain_status_study_count(course):
    assert brain.brain_status("course-one")["studyArtifacts"] == 0
    brain.write_study_artifact("course-one", "t1", type_="testprep",
                               course_name="C", body="x", sources=[])
    assert brain.brain_status("course-one")["studyArtifacts"] == 1
