---
name: ares-brain-course-daily
description: The 6 AM job — scrape Mesa, sync the calendar, write daily/<date>.md and notify. Run by launchd via `claude -p /mesa:ares-brain-course-daily`; also runnable by hand.
---

# course-daily

Produce this morning's brief. Every step tolerates the previous one failing —
never abort; a partial brief beats no brief.

## 1. Refresh the data

Run: `cd scraper && uv run python lms_scrape.py all --json`

- Parse the JSON. Keep `result.errors` (if any) and whether the exit was non-zero.
- If it failed with an auth error (message mentions token / 401 / refresh), that is
  the headline for the digest banner: the user must paste a fresh `MESA_REFRESH_TOKEN`
  into `.env`.
- Do NOT stop. Continue with whatever data is already on disk.

## 2. Sync the calendar

Run: `cd scraper && uv run python lms_scrape.py calendar-sync --json`

- Note `status`, `created/updated/deleted`, `errors`. `status: needs-auth` → banner
  line: run `cd scraper && uv run python lms_scrape.py calendar-auth`.
- Continue regardless.

## 3. Get the brief data

Call the `daily_brief` tool (no args). Keep `brief`.

## 4. Write `daily/<YYYY-MM-DD>.md`

Use today's LOCAL date for the filename.

Path composition — the values `daily_brief` returns are course-relative:

- A pre-read path is readable at `courses/<that class's courseSlug>/<prereadPath>` —
  e.g. `courses/the-art-of-selling-.../normalized/material-session-5-pre-read.md`.
- `brief.changed`'s keys are course slugs (the directories under `courses/`).

`Read` each pre-read / changed doc you cite (at its composed path) to get its real title.

Structure:

```
# <date> — morning brief

> ⚠️ <only if step 1/2 failed or brief.scrapeStale> — one line, what to run by hand.

## Today's classes
- **HH:MM–HH:MM** <course> — <room> (<instructor>)
  - pre-read: [<title>](courses/<courseSlug>/<prereadPath>)
  - _no pre-reads found_        ← when prereadPaths is empty
_no classes today_             ← when classesToday is empty

## Due soon
- [ ] **<title>** — <course> — due <relative, e.g. "in 2 days"> (<abs, IST>) <`[submitted]` if so>
_nothing due in the next 72h_  ← when empty

## What changed
- <course>: <n> materials, <m> announcements   ← from brief.changed
_nothing new since the last scrape_            ← when brief.changed is empty

## Mindset
<2–4 sentences. Grounded in TODAY: how many classes, whether an exam is within a
week, the nearest deadline, what changed. Calm and specific — the register of the
"Power of Communication" course, not hype. No generic affirmations.>
```

## 5. Notify

Run: `osascript -e 'display notification "<summary>" with title "Mesa — morning brief"'`

`<summary>` = `<N> classes · <M> due soon · <K> changes`
(prefix `scrape failed — ` when step 1 failed). Keep it under ~100 chars.
