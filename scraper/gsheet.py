"""Fetch a link-shared Google Sheet (the course outline) via its CSV export.

The LMS stores the outline as an HTML `text` material whose only content is an
<a href> to a Google Sheet. Link-shared sheets export without auth at
https://docs.google.com/spreadsheets/d/<id>/export?format=csv .
"""
import csv
import io
import re

import requests

_ID_RE = re.compile(r"docs\.google\.com/spreadsheets/d/([a-zA-Z0-9_-]+)")
_TIMEOUT = 30


def sheet_id_from_html(html: str) -> str | None:
    m = _ID_RE.search(html or "")
    return m.group(1) if m else None


def fetch_csv(sheet_id: str) -> str | None:
    url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv"
    try:
        resp = requests.get(url, timeout=_TIMEOUT)
    except requests.RequestException:
        return None
    if resp.status_code != 200 or not resp.text.strip():
        return None
    return resp.text


def csv_to_markdown_table(csv_text: str) -> str:
    rows = list(csv.reader(io.StringIO(csv_text)))
    rows = [r for r in rows if any(cell.strip() for cell in r)]
    if not rows:
        return ""
    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]
    header, *body = rows
    out = ["| " + " | ".join(cell.replace("|", "\\|") for cell in header) + " |",
           "| " + " | ".join("---" for _ in header) + " |"]
    for r in body:
        out.append("| " + " | ".join(cell.replace("|", "\\|") for cell in r) + " |")
    return "\n".join(out)
