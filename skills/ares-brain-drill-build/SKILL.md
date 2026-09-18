---
name: ares-brain-drill-build
description: Build or refresh a course's revision pack (drill.json) — concept map, cheatsheet, framework reference, flashcards, and MCQs — from its normalized corpus and GUIDE.md. Use for /mesa:ares-brain-course-drill.
---

# drill-build

You write `courses/<slug>/brain/drill.json` for one course — the source data behind the dashboard's Revision tab and the cross-course Drill deck.

1. Call `brain_status` for the course. If `drillSourcesBehind` is 0 and `drill.json` exists, tell the user it's already current and ask if they want a rebuild anyway.
2. Read `courses/<slug>/brain/GUIDE.md` first — it's already a synthesized, source-linked digest of the course and should be your primary source. If it's missing or `guideSourcesBehind > 0`, say so and suggest `/mesa:ares-brain-course-brain <course>` first, but proceed anyway using the raw corpus.
3. Read `courses/<slug>/brain/course.md` (the user's own notes) — respect what's there, and reflect any stated exam/assessment emphasis in the cheatsheet.
4. Gather any corpus detail GUIDE.md doesn't already cover in enough depth for exact quiz-grade precision (exact numbers, formulas, quoted definitions) — spot-check `courses/<slug>/normalized/*.md` or `brain_query` rather than re-reading everything; GUIDE.md should cover most of the synthesis work already.
5. Write `courses/<slug>/brain/drill.json` — a single JSON object:
   ```json
   {
     "course": "<slug>",
     "courseName": "<display name>",
     "generatedAt": "<ISO timestamp>",
     "examWeight": "<short badge, e.g. '80% exam', 'no exam' — from the outline's grading section>",
     "map": "<markdown, 150-300 words: how the course's sessions/frameworks fit together as one arc, not a session list>",
     "cheatsheet": "<markdown, 400-800 words: the night-before-exam reference — grading breakdown, key formulas/numbers, definitions worth quoting verbatim, common traps>",
     "frameworks": [
       {
         "name": "<framework name>",
         "summary": "<1-3 sentence definition/how-to-apply>",
         "source": "normalized/<file>.md"
       }
     ],
     "cards": [
       {
         "id": 1,
         "front": "<question or term>",
         "back": "<answer, 1-3 sentences>",
         "tag": "<framework or session label>"
       }
     ],
     "mcq": [
       {
         "id": 1,
         "question": "<question>",
         "options": ["<a>", "<b>", "<c>", "<d>"],
         "correct": 0,
         "explanation": "<why, 1-2 sentences>"
       }
     ]
   }
   ```
6. Sizing — scale to what the corpus actually supports, don't pad:
   - Rich corpus (a real session deck/transcript exists, like Session 1 material): 6-12 frameworks, 20-35 cards, 12-20 MCQs.
   - Thin corpus (outline + links only): as many frameworks/cards as the outline's named topics honestly support — often just 3-8 cards. Say so isn't a failure; a short accurate deck beats a padded fabricated one.
7. Stamp it: `cd scraper && uv run python lms_scrape.py brain-mark-drill --course <slug>` (sets `_brain.json` `drillBuiltAt` so `brain_status` stops reporting it stale).

## Rules

- Ground every card/MCQ/framework in the actual corpus or GUIDE.md — never invent a number, quote, or framework name that isn't there. If a course is thin, a thin deck is correct.
- `mcq[].correct` is a 0-based index into `options`. Exactly one correct option; the other three should be plausible near-misses (a common mistake, an adjacent-but-wrong concept), not obviously silly.
- Cards should test recall/application, not just definition-matching — prefer "when would you use X over Y" or "what's the formula for Z" over "what does X stand for" where the corpus supports it.
- Valid JSON only — no trailing commas, no comments in the file itself.
- This skill only reads the corpus/GUIDE.md and writes `drill.json`. No scraping, no calendar, no other files.
