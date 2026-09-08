---
description: Transcribe class recordings and normalize all scraped + dropped material.
---

Run the `transcribe` tool, then the `ingest` tool, from the mesa MCP
server (pass `course` only if the user named one).

Report:

- recordings transcribed / skipped / needs-manual (list the needs-manual titles verbatim)
- normalized files written and orphans deleted, per course
- any entries in `errors`

Do not summarise the material — this command only builds the corpus.
