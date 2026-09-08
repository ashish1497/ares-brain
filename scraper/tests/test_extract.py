from pathlib import Path
import pytest
from extract import extract_text, UnsupportedFormat

FIX = Path(__file__).parent / "fixtures" / "scrubbed"


def test_pdf():
    text = extract_text(FIX / "sample.pdf")
    assert "Hello from the sample PDF" in text


def test_docx():
    text = extract_text(FIX / "sample.docx")
    assert "paragraph one" in text and "paragraph two" in text


def test_pptx():
    text = extract_text(FIX / "sample.pptx")
    assert "Slide one title" in text and "Slide two title" in text


def test_xlsx():
    text = extract_text(FIX / "sample.xlsx")
    assert "Header A" in text and "cell b2" in text


def test_unknown_suffix_raises():
    with pytest.raises(UnsupportedFormat):
        extract_text(FIX / "outline.csv")
