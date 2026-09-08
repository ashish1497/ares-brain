---
description: Pull the latest data for every Mesa course onto disk.
---

Run the `scrape` tool from the mesa-course-agent MCP server with no arguments
(or with `course` set to a slug if the user named one specific course).

When it returns, report to the user:

- the term and course count (`term`, `courses`)
- how many assignments are unassigned / need a course (`assignmentsUnassigned`)
- the number of calendar events pulled (`events`)
- any entries in `errors` (verbatim)

Do not summarise the course content — this command only refreshes the data on
disk under `courses/<slug>/raw/`.
