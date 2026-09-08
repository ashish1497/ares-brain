from pathlib import Path
import requests
import gsheet

FIX = Path(__file__).parent / "fixtures" / "scrubbed"


def test_sheet_id_from_html():
    html = ('<p><a href="https://docs.google.com/spreadsheets/d/1zqoZBC1aeA_03f8Je/edit?usp=sharing">'
            'Outline</a></p>')
    assert gsheet.sheet_id_from_html(html) == "1zqoZBC1aeA_03f8Je"


def test_sheet_id_none_when_absent():
    assert gsheet.sheet_id_from_html("<p>no link here</p>") is None


def test_csv_to_markdown_table():
    md = gsheet.csv_to_markdown_table((FIX / "outline.csv").read_text())
    assert "| Session | Date | Topic | Pre-read |" in md
    assert "| 1 | 2026-08-20 | Intro to Frameworks | Chapter 1 |" in md


def test_csv_to_markdown_table_ragged_and_quoted():
    md = gsheet.csv_to_markdown_table('a,b,c\n"x, with comma",y\n1|pipe,2,3,4\n\n')
    lines = md.splitlines()
    assert all(line.strip() for line in lines)  # blank line dropped
    assert "| x, with comma | y |  |  |" in md  # quoted comma kept, padded to 4
    assert "| 1\\|pipe | 2 | 3 | 4 |" in md  # pipe escaped
    # same delimiter count per row (escaped \| has no surrounding spaces, not a delimiter)
    counts = {line.count(" | ") for line in lines}
    assert counts == {3}


def test_fetch_csv_ok(monkeypatch):
    class R:
        status_code = 200
        text = "a,b\n1,2\n"
    monkeypatch.setattr(requests, "get", lambda *a, **k: R())
    assert gsheet.fetch_csv("SHEETID") == "a,b\n1,2\n"


def test_fetch_csv_403_returns_none(monkeypatch):
    class R:
        status_code = 403
        text = "denied"
    monkeypatch.setattr(requests, "get", lambda *a, **k: R())
    assert gsheet.fetch_csv("SHEETID") is None
