import json
import os
from pathlib import Path
import pytest

FIX = Path(__file__).parent / "fixtures" / "scrubbed"


@pytest.fixture
def scrubbed():
    def _load(name: str) -> dict:
        return json.loads((FIX / name).read_text())
    return _load


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("COURSE_AGENT_HOME", str(tmp_path))
    monkeypatch.chdir(tmp_path)
    (tmp_path / "courses").mkdir()
    import importlib
    import paths
    importlib.reload(paths)
    yield tmp_path
