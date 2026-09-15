import pytest
import student_identity as si


def test_my_name_from_env(monkeypatch):
    monkeypatch.setenv("ARES_BRAIN_STUDENT_NAME", "Priya")
    assert si.my_name() == "Priya"


def test_my_name_missing_raises(monkeypatch):
    monkeypatch.delenv("ARES_BRAIN_STUDENT_NAME", raising=False)
    with pytest.raises(ValueError, match="ARES_BRAIN_STUDENT_NAME"):
        si.my_name()
