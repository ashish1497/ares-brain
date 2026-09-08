"""Generate synthetic sample media for the extract/transcribe tests.

Run once:  cd scraper && uv run python tests/make_fixtures.py
Committed outputs live in tests/fixtures/scrubbed/. Not run in CI.
All content is invented — no PII.
"""
import csv
import math
import struct
import wave
from pathlib import Path

OUT = Path(__file__).parent / "fixtures" / "scrubbed"
OUT.mkdir(parents=True, exist_ok=True)

# --- PDF: one page, known text ---
from pypdf import PdfWriter
try:
    from reportlab.pdfgen import canvas  # optional; fallback below
    c = canvas.Canvas(str(OUT / "sample.pdf"))
    c.drawString(72, 720, "Hello from the sample PDF.")
    c.drawString(72, 700, "Second line of the sample.")
    c.save()
except ImportError:
    # minimal hand-rolled single-page PDF with a text object
    pdf = (
        b"%PDF-1.4\n"
        b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R"
        b"/Resources<</Font<</F1 5 0 R>>>>>>endobj\n"
        b"4 0 obj<</Length 74>>stream\nBT /F1 12 Tf 72 720 Td "
        b"(Hello from the sample PDF.) Tj T* (Second line of the sample.) Tj ET\nendstream endobj\n"
        b"5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n"
        b"trailer<</Root 1 0 R>>\n%%EOF"
    )
    (OUT / "sample.pdf").write_bytes(pdf)

# --- DOCX ---
from docx import Document
d = Document()
d.add_paragraph("Sample DOCX paragraph one.")
d.add_paragraph("Sample DOCX paragraph two.")
d.save(OUT / "sample.docx")

# --- PPTX: two slides ---
from pptx import Presentation
p = Presentation()
for text in ("Slide one title", "Slide two title"):
    slide = p.slides.add_slide(p.slide_layouts[5])
    slide.shapes.title.text = text
p.save(OUT / "sample.pptx")

# --- XLSX: 2x2 ---
from openpyxl import Workbook
wb = Workbook()
ws = wb.active
ws.append(["Header A", "Header B"])
ws.append(["cell a2", "cell b2"])
wb.save(OUT / "sample.xlsx")

# --- outline.csv ---
with open(OUT / "outline.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["Session", "Date", "Topic", "Pre-read"])
    w.writerow(["1", "2026-08-20", "Intro to Frameworks", "Chapter 1"])
    w.writerow(["2", "2026-08-27", "Unit Economics", "Chapter 2"])

# --- sample.wav: 3s, 8kHz mono, a 440Hz tone (whisper will emit ~nothing but a valid file) ---
with wave.open(str(OUT / "sample.wav"), "w") as wv:
    wv.setnchannels(1); wv.setsampwidth(2); wv.setframerate(8000)
    for i in range(8000 * 3):
        wv.writeframes(struct.pack("<h", int(3000 * math.sin(2 * math.pi * 440 * i / 8000))))
print("wrote fixtures to", OUT)
