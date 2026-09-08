"""HTML content fields (assignment instructions, material bodies, announcements)
to markdown. Links are kept — the Google Sheets / workbook URLs matter."""
import re

from markdownify import markdownify


def html_to_markdown(html: str) -> str:
    if not html or not html.strip():
        return ""
    md = markdownify(html, heading_style="ATX", strip=["span"])
    md = re.sub(r"\n{3,}", "\n\n", md)
    return md.strip()
