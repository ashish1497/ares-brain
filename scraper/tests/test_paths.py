import os
from pathlib import Path
import pytest
from paths import slugify, course_dir, raw_dir, global_file, HOME


@pytest.mark.parametrize("name,expected", [
    ("Business Frameworks with Alex Doe", "business-frameworks-with-alex-doe"),
    ("AI and its Application", "ai-and-its-application"),
    ("Data — Session (2)", "data-session-2"),
    ("  Trailing/Leading  ", "trailing-leading"),
])
def test_slugify(name, expected):
    assert slugify(name) == expected


def test_dirs_are_under_home(tmp_path, monkeypatch):
    monkeypatch.setenv("ARES_BRAIN_HOME", str(tmp_path))
    import importlib, paths
    importlib.reload(paths)
    assert paths.course_dir("x") == tmp_path / "courses" / "x"
    assert paths.raw_dir("x") == tmp_path / "courses" / "x" / "raw"
    assert paths.global_file("_index.json") == tmp_path / "courses" / "_index.json"
