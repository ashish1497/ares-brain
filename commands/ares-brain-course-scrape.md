---
description: Pull the latest data for every Mesa course onto disk.
---

Run the `scrape` tool from the mesa MCP server with no arguments
(or with `course` set to a slug if the user named one specific course).

When it returns, report to the user:

- the term and course count (`term`, `courses`)
- how many assignments are unassigned / need a course (`assignmentsUnassigned`)
- the number of calendar events pulled (`events`)
- any entries in `errors` (verbatim)

Do not summarise the course content — this command only refreshes the data on
disk under `courses/<slug>/raw/`.

After reporting the above, check `brain_status` (no course) for any course where
`drillSourcesBehind > 0` and `sourceCount > 0`. Automatically refresh each one via the
`ares-brain-drill-build` skill (this is the standing behavior — the user asked for
revision packs to stay current on every rescrape, not to be asked each time). Cap it at
the 3 most-stale courses in one run so a big scrape doesn't turn into an unbounded
content pass; the rest catch up on the next rescrape. Report per-course results (built /
skipped / already current) alongside the scrape summary above.
