---
name: ares-brain-ask
description: Answer a question about one course, grounded in its material with source citations. Use for /mesa:ares-brain-ask.
---

# ask

Answer the user's question about a course, using only that course's material.

1. Match the course name (or partial) the user gave to a slug from `courses/_index.json`. If ambiguous, ask which.
2. Call `brain_query` with `{ course: "<slug>", text: "<the question>", limit: 8 }`.
3. Call `brain_get` for the top 3-5 hits by `path`. Also Read `courses/<slug>/brain/GUIDE.md` and `courses/<slug>/brain/course.md` if they exist.
4. Answer in 150-400 words. **Cite every factual claim** inline as `[normalized/<file>.md]` — the file it came from.
5. If the material does not support an answer: say "That's not in the course material for <course>." and name the closest thing you did find.
6. Write nothing to disk. This is a conversation, not an artifact.

## Rules

- Never answer from general knowledge without flagging it as "(not from the course material)".
- If `brain_query` returns nothing, say so — don't invent.
