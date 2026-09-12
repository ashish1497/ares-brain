---
name: ares-brain-course-evening
description: The 6 PM job — refresh Mesa data, write daily/<date>-evening.md and notify. What's due, what's overdue, what tomorrow looks like. Run by launchd via `claude -p /mesa:ares-brain-course-evening`; also runnable by hand.
---

# course-evening

Produce this evening's check. Every step tolerates the previous one failing —
never abort; a partial check beats no check.

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

Call the `daily_brief` tool with `{ includeTomorrow: true }`. Keep `brief`.

## 4. Write `daily/<YYYY-MM-DD>-evening.md`

Use today's LOCAL date for the filename (the day this check runs, not tomorrow's).

Path composition — same as the morning brief:

- A pre-read path is readable at `courses/<that class's courseSlug>/<prereadPath>`.
- `brief.changed`'s keys are course slugs.

`Read` each pre-read / changed doc you cite to get its real title.

Structure:

```
# <date> — evening check

> ⚠️ <only if step 1/2 failed or brief.scrapeStale> — one line, what to run by hand.

## Flagged
- **<title>** — <course> — was due <relative, e.g. "6h ago"> — not submitted   ← brief.overdue
- **<title>** — <course> — due <relative, e.g. "in 3h"> — not submitted yet    ← brief.assignmentsDue items with hoursAway <= 12 and submitted == false
_nothing flagged — you're clear_   ← when both of the above are empty

## Due soon
- [ ] **<title>** — <course> — due <relative> (<abs, IST>) <`[submitted]` if so>
_nothing due in the next 72h_  ← when brief.assignmentsDue is empty

## Tomorrow
- **HH:MM–HH:MM** <course> — <room> (<instructor>)
  - pre-read: [<title>](courses/<courseSlug>/<prereadPath>)
  - _no pre-reads found_        ← when prereadPaths is empty
_no classes tomorrow_          ← when brief.classesTomorrow is empty

## What changed today
- <course>: <n> materials, <m> announcements   ← from brief.changed
_nothing new since the last scrape_            ← when brief.changed is empty

## Plan for tonight
<2–4 sentences. Grounded in the actual data above: what to read tonight for
tomorrow's first class, what's due soon and whether it needs starting tonight,
and anything flagged that genuinely needs attention before bed. Calm and
specific — the register of the "Power of Communication" course, not hype.
If everything is clear, say so plainly instead of manufacturing urgency.>
```

The "Flagged" section is the point of this check — it's the difference between
this and the morning brief. Don't bury an overdue or almost-due item under a
wall of routine "due soon" rows; call it out first.

## 5. Notify

Run: `osascript -e 'display notification "<summary>" with title "Mesa — evening check"'`

`<summary>` = `<F> flagged · <M> due soon · <K> classes tomorrow`
(prefix `scrape failed — ` when step 1 failed). Keep it under ~100 chars.
