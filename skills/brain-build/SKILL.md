---
name: brain-build
description: Build or refresh a course's GUIDE.md — a structured overview of concepts, frameworks, and how the sessions connect — from its normalized corpus. Use for /course-brain.
---

# brain-build

You write `courses/<slug>/brain/GUIDE.md` for one course from its material.

1. Call `brain_status` for the course. If `guideSourcesBehind` is 0 and `GUIDE.md` exists, tell the user it's already current and ask if they want a rebuild anyway.
2. Ensure the course.md notes file exists: if `courses/<slug>/brain/course.md` is missing, tell the user you're creating a blank one they can fill in (the `ensure_course_md` step / `brain-index` will have made it; if not, create it with the template headings: "What the professor emphasises", "Exam / assessment style", "Topics I'm weak on", "Things to remember").
3. Read `courses/<slug>/brain/course.md` — respect what the user wrote there.
4. Gather the corpus:
   - If `brain_status.corpusBytes` < ~120000: read every `courses/<slug>/normalized/*.md`.
   - Else: read all non-transcript docs in full, plus `brain_query({course, type: "transcript"})` snippets and the single most recent transcript in full.
5. Write `courses/<slug>/brain/GUIDE.md`:
   - **Overview** — 3-5 sentences: what the course builds toward.
   - **Key concepts & frameworks** — each: name, one-line definition, which sessions cover it, `[source](normalized/…md)` links.
   - **Session arc** — a short ordered list: session N → what it adds.
   - **Glossary** — terms from transcripts/notes, one line each.
   - **Open threads** — questions raised but not resolved in the material.
   - Keep it skimmable — headings + bullets, ~600-1000 words.
6. Stamp the guide as current: run `cd scraper && uv run python lms_scrape.py brain-mark-guide --course <slug>` (or ask the user to). This sets `_brain.json` `guideBuiltAt` so `brain_status` stops reporting it stale.

## Rules

- Ground every claim in a source doc — link it. If the corpus doesn't support a section, write "not enough material yet".
- Never touch `course.md` (the user's file) beyond creating a blank template.
- This skill only reads the corpus and writes GUIDE.md. No scraping, no calendar.
