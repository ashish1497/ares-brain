---
name: briefing
description: Assemble a pre-class briefing for one course's next session, or a week-ahead view across all courses. Use for /course-brief and /week-ahead.
---

# Briefing

You produce a study briefing from the course brain. Two modes.

## Mode A — one course, next session (`/course-brief <course>`)

1. Call `brain_next_session` with the course slug. If it returns null, tell the user there's no upcoming session on record and stop.
2. Note `nextIndex`, `startAt`, `outlineRow`, `prereadPaths`.
3. Read every file in `prereadPaths` (they are paths under `courses/<slug>/`). Read `courses/<slug>/brain/GUIDE.md` and `courses/<slug>/brain/course.md` if they exist.
4. Call `brain_query` with `{course: "<slug>", sessionMax: <nextIndex>}` (no text) to see what came before, and `{course: "<slug>", type: "assignment", dueBefore: "<startAt>"}` for anything due by class time.
5. Write the brief. If `outlineRow` is null, use the event title as the session topic and derive "What it covers" from the pre-read content alone; if `prereadPaths` is also empty, say plainly that no pre-reads are on record for this session and brief from GUIDE.md + the event title.
   - **Session N — <topic>** (date/time)
   - **What it covers** — 2-4 sentences from the outline row + pre-read content.
   - **Read first** — ordered list of the pre-reads, each with one line on why and roughly how long.
   - **Questions to hold** — 3-5 questions the reading should let the user answer.
   - **Connects to** — 1-2 links back to earlier sessions/concepts (from GUIDE.md / earlier material).
   - **Before class** — any assignment due by `startAt`, with its own one-line "what to do".
     Keep it to ~250-400 words. Do not dump the pre-read text back.

## Mode B — week ahead (`/week-ahead`)

1. Read `courses/_events.json`. Take events with `eventType` in (`session`, `exam`) and `startAt` within 7 days of now, sorted by `startAt`.
2. Group by day. For each event: course name, session topic (from that course's `brain_next_session` / outline if it's the next one, else the event title), one must-read (top `brain_query` material hit for that session), and any assignment due that day (`brain_query` type assignment, dueBefore end-of-day).
3. Output a compact day-by-day list. 3-5 lines per event. No deep dives.

## Rules

- Never invent session content — if the outline row and pre-reads are thin, say so.
- If `GUIDE.md` is missing, note "run /course-brain <course> for a richer briefing" once.
- These commands only assemble and explain existing material; they do not create assignments, calendar events, or files.
