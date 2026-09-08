---
description: Sync assignment/exam deadlines and the class schedule to the "Mesa Assignments" Google Calendar.
---

Run the `calendar_sync` tool (pass `dryRun: true` if the user says "preview" / "dry run").

Report:

- the calendar name and whether it was just created
- created / updated / deleted / unchanged counts
- any `errors` verbatim
- if `status` is `needs-auth`, tell the user to run exactly:
  `cd scraper && uv run python lms_scrape.py calendar-auth`
  (one-time browser consent; needs a Desktop-type `client_secret.json` at the repo root), then re-run.

This command only writes to the dedicated "Mesa Assignments" calendar — never the primary calendar.
