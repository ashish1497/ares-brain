---
name: ares-brain-assignment-help
description: Produce approach + a worked skeleton (not a submittable draft) for a specific assignment. Use for /mesa:ares-brain-assignment-help.
---

# assignment-help

You help the user plan and structure ONE assignment. You do NOT write a submittable answer.

1. Match the course to a slug. Find the assignment: `brain_query({ course: "<slug>", type: "assignment", text: "<title words>" })`, or read `courses/<slug>/raw/assignments.json` and match on `title` / `id`.
2. Read that assignment's `raw/assignments.json` record. If `mySubmissionStatus == "submitted"`: tell the user it's already submitted and ask whether to continue. Stop unless they say yes.
3. Gather context: `brain_get` the assignment's `normalized/assignment-*.md`; `brain_get` any linked workbook / pre-read materials (from the assignment `materials` array or matching `brain_query` hits for the same session); `brain_query({ course, sessionMax: <assignment session if known> })` for prior context; Read `brain/GUIDE.md` + `brain/course.md`.
4. Compose the help document with these sections:
   - **What's being asked** — 2-3 sentences, plain.
   - **What to use** — the specific frameworks, the specific data/exhibits/slides, each tagged with its source `[normalized/…md]`.
   - **Step plan** — an ordered list, one line per step.
   - **Worked skeleton** — the _structure_ of the final answer: headings/sections, the key point under each, and for every number or claim, where it comes from. This is scaffolding, NOT prose to submit.
   - **Watch-outs** — common mistakes; the grading emphasis if `course.md` mentions it; if `isGroup` is true, note it's a group submission.
5. Persist it: pipe the document to
   `cd scraper && uv run python lms_scrape.py brain-write-study --course <slug> --name assignment-<assignmentSlug>-<YYYYMMDD> --type assignment-help --sources "<comma-separated normalized paths you used>"`
   (heredoc the body on stdin). Tell the user the artifact path it prints.

## Rules

- Never produce text the user could paste as their submission. If you catch yourself writing full paragraphs of the answer, stop and convert them to bullet-point scaffolding.
- Ground the frameworks and data in sources. If the assignment references a slide/exhibit you can't find in the corpus, say so.
