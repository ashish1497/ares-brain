from html2md import html_to_markdown


def test_preserves_link():
    html = '<p>See the <a href="https://docs.google.com/spreadsheets/d/ABC/edit">workbook</a> here.</p>'
    md = html_to_markdown(html)
    assert "[workbook](https://docs.google.com/spreadsheets/d/ABC/edit)" in md


def test_empty():
    assert html_to_markdown("") == ""
    assert html_to_markdown("   ") == ""


def test_collapses_blank_runs():
    md = html_to_markdown("<p>a</p><p></p><p></p><p>b</p>")
    assert "a" in md and "b" in md
    assert "\n\n\n" not in md
