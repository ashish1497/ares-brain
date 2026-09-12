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

## Missed
- **<title>** — <course> — was due <relative, e.g. "6h ago"> — not submitted   ← from brief.overdue
_(section omitted entirely when brief.overdue is empty)_

## Today's classes
- **HH:MM–HH:MM** <course> — <room> (<instructor>)
  - pre-read: [<title>](courses/<courseSlug>/<prereadPath>)
  - _no pre-reads found_        ← when prereadPaths is empty
  - **Mindset:** <1–2 sentences, specific to THIS class — what today's session/topic
    is, what the pre-read sets up, and one concrete thing to walk in ready to do
    (a question to ask, a point to bring up, a concept to have skimmed). Never a
    generic "stay focused" line — ground it in the actual session title / pre-read
    content you just read.
_no classes today_             ← when classesToday is empty

## Due soon
- [ ] **<title>** — <course> — due <relative, e.g. "in 2 days"> (<abs, IST>) <`[submitted]` if so>
_nothing due in the next 72h_  ← when empty

## What changed
- <course>: <n> materials, <m> announcements   ← from brief.changed
_nothing new since the last scrape_            ← when brief.changed is empty

## Today, overall
<1–2 sentences. Day-level framing only — total load, whether an exam is within a
week, the nearest deadline. Per-class thinking already happened above; don't repeat
it here. Calm and specific — the register of the "Power of Communication" course,
not hype. No generic affirmations.>
```

Each class's Mindset line is the point of this section — it is what makes the
brief worth more than the raw schedule. If a class has no pre-read and no
session-title signal, say plainly there's not enough to ground a mindset line on
rather than inventing one.

## 5. Notify

Run: `osascript -e 'display notification "<summary>" with title "Mesa — morning brief"'`

`<summary>` = `<N> classes · <M> due soon · <K> changes`
(prefix `<P> missed · ` when brief.overdue is non-empty; prefix `scrape failed — `
when step 1 failed). Keep it under ~100 chars.
