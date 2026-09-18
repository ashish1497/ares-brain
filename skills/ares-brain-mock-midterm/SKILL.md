---
name: ares-brain-mock-midterm
description: Generate a mock mid-term paper matching the real declared exam format (marks, timing, question types, negative marking) for one course, persisted to study/. Use for /mesa:ares-brain-mock-midterm.
---

# mock-midterm

Generate a practice paper that matches the _actual_ declared mid-term format for a course — not the generic testprep mix.

1. Read `config/midterm-exam-format.md` first, always. It's the only place the real format lives (emailed by the program team, never scraped into the LMS corpus) — never invent marks/timing/question-types from guesswork.
2. Match the user's course argument to a slug and find its entry in that file.
   - Not listed at all, or listed under "not written exams" → **stop and tell the user**: this course's mid-term isn't a written exam (say what it actually is — assignment/pitch/hackathon/etc per the doc), so a mock paper doesn't fit the format. Don't generate one. Offer to draft practice material matching what it _actually_ is instead, only if asked.
   - Listed under "written exams" → proceed.
   - The doc is dated — if today is well past its `examDate` frontmatter field, say so and ask whether to proceed anyway (the format may be stale for a later term).
3. Determine session scope the same way as `ares-brain-testprep`: call `brain_next_session({ course })`, use 1 through `sessionsConducted`. Cross-check against the "Portions" line in the format doc — if the format doc names a specific session/chapter range, that wins over `sessionsConducted` (e.g. Finance's doc explicitly says "up to Session 9" even if fewer sessions are locally ingested — note the gap plainly at the top of the paper rather than silently using a smaller scope).
4. Gather material the same way as `ares-brain-testprep` step 2: `brain_query({ course, sessionMax })`, plus unfiltered `type: "transcript"` and `type: "book-summary"` queries, `brain_get` a spread of hits, read `brain/GUIDE.md` + `brain/course.md` if present.
5. Write the paper matching the format doc's exact structure:
   - Section breakdown and mark allocation that sums to the doc's total marks.
   - Exact question types named in the doc (MCQ / True-False / Short Conceptual / Problems — never substitute a type the doc doesn't list).
   - State the doc's timing, open/closed-book rule, and negative marking (if any) at the top of the paper.
   - Every question gets a `<details><summary>Model answer</summary>…</details>` block, same as testprep, citing `[normalized/…md]` sources.
   - Label each question `**Qn [Type]**` (matches the dashboard's Testprep-tab reader, which splits on that exact marker — don't use a different heading style).
6. If the local corpus doesn't reach the portions the format doc names (e.g. doc says "up to Session 9" but only 7 sessions are ingested), say so plainly at the top of the paper — don't pad or fabricate the missing sessions' content.
7. Persist: heredoc the whole paper (body on stdin) to
   `cd scraper && uv run python lms_scrape.py brain-write-study --course <slug> --name mock-midterm-<YYYYMMDD> --type mock-midterm --course-name "<course display name>" --sources "<comma-separated normalized paths used>"`.
   Tell the user the path it prints.
8. Ask if they want to share it with classmates (same opt-in flow as testprep step 6) — `share-study --course <slug> --name <name> --json` only on yes.

## Rules

- Never fabricate exam format details not present in `config/midterm-exam-format.md`.
- Every model answer cites a real source path.
- If the format doc says a course has no written exam, that's the answer — don't generate a paper anyway because the user asked for "a mock midterm."
