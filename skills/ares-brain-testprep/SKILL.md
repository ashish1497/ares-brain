---
name: ares-brain-testprep
description: Generate a graded practice question set for a course, with collapsible model answers, persisted to study/. Use for /mesa:ares-brain-testprep.
---

# testprep

Generate ~15 practice questions for a course.

1. Match the course to a slug. Determine the session scope:
   - If the user gave `N-M`, use sessions N through M.
   - Else call `brain_next_session({ course })` and use 1 through `sessionsConducted` (fall back to "all material" if that's null).
2. Gather:
   - `brain_query({ course, sessionMax: <M> })` broadly (limit 20). When the user gave a range `N-M`, also pass `sessionMin: <N>` so sessions before N are excluded.
   - Transcripts and book summaries are written with no `session`, so a session-scoped query silently drops them. Run two more UNfiltered queries and merge the hits: `brain_query({ course, type: "transcript", limit: 20 })` and `brain_query({ course, type: "book-summary", limit: 20 })`.
   - `brain_get` a spread of the merged hits (materials, sessions, transcripts, any `book-summary`), Read `brain/GUIDE.md` + `brain/course.md`.
3. Write questions across three kinds:
   - **Recall** (3-4): define / explain a framework or term.
   - **Application** (7-8): a 2-3 sentence scenario, "apply X to decide Y".
   - **Mini-case** (1-2): a short exhibit (a few numbers or a paragraph) + 2-3 sub-questions.
     Label each: `**Q1 [Application · Medium]**`. After each question:
   ```
   <details><summary>Model answer</summary>

   … the answer or a rubric …
   </details>
   ```
4. If the corpus for the scope is thin (few sessions of material), generate fewer questions and say so at the top — don't pad.
5. Persist: heredoc the whole set (body on stdin) to
   `cd scraper && uv run python lms_scrape.py brain-write-study --course <slug> --name testprep[-s<N>-<M>]-<YYYYMMDD> --type testprep --sources "<comma-separated normalized paths used>"`.
   Tell the user the path it prints.

## Rules

- Questions must be answerable from the course material — every model answer cites `[normalized/…md]`.
- Match Mesa's style (business-school: frameworks, cases, application) — infer it from the assignment/material docs, don't assume multiple-choice.
