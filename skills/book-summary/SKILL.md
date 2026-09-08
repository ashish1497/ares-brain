---
name: book-summary
description: Summarize the books dropped for a course and list books mentioned in class but not uploaded. Use for /book-summary.
---

# book-summary

1. Match the course to a slug (ask which if none given).
2. `brain_query({ course: "<slug>", type: "book", limit: 20 })`. For each hit, `brain_get` the full body.
3. For each book, write a summary with:
   - **Thesis** — 1-2 sentences.
   - **Key ideas** — grouped by the book's own parts/sections, each a short paragraph.
   - **Frameworks / models** — each with a one-line definition.
   - **Memorable examples** — 2-3.
   - **Connections to this course** — cross-reference concepts from `brain/GUIDE.md`.
     Persist each: heredoc the body on stdin to
     `cd scraper && uv run python lms_scrape.py brain-write-study --course <slug> --name book-<bookSlug>-summary --type book-summary --sources "normalized/<the book doc>.md"`.
4. Mention scan: `brain_query({ course, type: "transcript", text: "book read author recommend must-read" })` and the same for `type: "self-note"`. `brain_get` the hits. Extract candidate book titles + authors named as recommended reading. Drop any that already exist as a `type: book` doc (compare loosely by title). List the remainder as:
   > **Mentioned in class, not uploaded:** <title> — <author?>. Drop the PDF into `inbox/<slug>/books/` and run `/course-ingest`.
5. Tell the user which summaries were written (paths) and the missing-book list. Note that after the next `/course-ingest` the summaries become searchable via `/ask`.

## Rules

- Summaries are your synthesis of the book's content — do not just quote long passages.
- The mention scan is best-effort: if you're unsure of a title, say "(title uncertain — lecturer said …)".
