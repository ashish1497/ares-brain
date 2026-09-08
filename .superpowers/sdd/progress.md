# C-tasks progress ledger

Plan: docs/superpowers/plans/2026-09-03-c-tasks.md
Branch: c-tasks    Base: main @ 2637949


- Task 1: complete (commit b72e907, review clean — approved, Minors only). brain.get_doc (traversal-safe) + brain-get subcommand + brain_get MCP tool. pytest 153, vitest 20. brain.py imports still clean.
  Deviations (both sound): fixture updatedAt quoted (matches real A-ingest _yaml_scalar output); shared brain_corpus fixture gained book-lean-startup.md -> bumped 3 corpus-size assertions 6->7 + added "book" to a type set (not loosened).
- Task 2: complete (commit 0704ed4, review clean — approved, Minors only). study_dir/write_study_artifact/list_study + brain-write-study subcommand + brain_status.studyArtifacts. pytest 158, vitest 20. imports clean.
- Task 3: complete (commit 39ca1cb, markdown-only, verbatim to approved plan; suites unchanged 158/20). ask skill + /ask command.
- Task 4: complete (commit db653e4, markdown-only, verbatim to plan; suites 158/20 unchanged). assignment-help skill + command.
- Task 5: complete (commit d4f6057, markdown-only, verbatim to plan; suites 158/20 unchanged). testprep skill + command.
- Task 6: complete (commit f75b496, review clean — approved, Minors only). book-summary skill + command + _normalize_study_book_summaries ingest rule + fixture + README + live run. pytest 159, vitest 20, build ok.
  LIVE ROUND-TRIP VERIFIED: study/book-*-summary.md -> ingest -> normalized/book-summary-*.md -> brain-index finds it via type:book-summary query -> delete study file -> re-ingest -> orphansDeleted:1, doc gone, query [].
  Minors -> final: ingest.py now has 2 frontmatter splitters (new parse_frontmatter + _normalize_transcripts inline) - could consolidate; report's "no yaml" rationale was false (yaml IS in venv) but code is fine; title fallback is stem.replace("-"," ") not bare stem.

ALL 6 C TASKS COMPLETE. pytest 159, vitest 20, tsc/build clean. Ready for whole-branch review.

## C-tasks whole-branch review — DONE
- Review (opus): 1 Critical + 7 Important + minors. Fix subagent → 187f410. Re-review (opus): all fixed, 1 trivial hygiene blocker (committed node_modules) → 9c956be. Ready to merge.
- Deferred follow-ups (non-blocking): (1) ingest.parse_frontmatter regex reader mishandles quotes/unicode vs yaml — make it use yaml; folds in the two-splitter consolidation. (2) confinement guards resolve after following a symlinked study/ or normalized/ dir — tighten to repo-containment. Both filed for post-merge.
- suites @ 9c956be: pytest 165, vitest 21, tsc + build clean.

## D-oauth — branch d-oauth off main (842f025). Plan: docs/superpowers/plans/2026-09-03-d-oauth.md (one task).
Task 1: NOT started. Step 9 (browser consent) needs user + a real Desktop client_secret.json (current one is "web" → do_auth rejects it correctly).

## D-oauth — MERGED to main @ 58a879b (2026-09-04)
Task 1 done (68a5b52), reviewed (sonnet, approved, Minors only), 1 Minor fixed (3d94e9e: do_auth non-object JSON guard). pytest 173, vitest 21, tsc/build clean. Branch deleted.
OPEN user-assisted: swap repo-root client_secret.json ("web") for a Desktop-type OAuth client, then `cd scraper && uv run python lms_scrape.py calendar-auth` (browser consent), then live calendar-sync verification. Commands in docs/lms-api.md "D-oauth live run — PENDING".

## D-oauth live run — DONE (2026-09-04)
User authed via Desktop client. calendar-sync live: created 7, 2nd run unchanged 7, 0 errors. Idempotent end to end. D fully shipped + verified.

## D-sessions — MERGED to main (2026-09-04). Class schedule + program events on the calendar.
Task 1 (a9cf1ef) + review (sonnet, approved) + stray .token.lock untracked. Merged.
Live: created 142 + updated 7 (canonical location slot), 2nd run unchanged 149, 0 errors. 94 sessions + 48 events + 5 exams + 2 asg. pytest 177.

## E — daily job. Branch e-daily off main. Spec .../specs/2026-09-04-e-daily-design.md, plan .../plans/2026-09-04-e-daily.md (5 tasks).
T1 daily_brief.py+CLI  T2 MCP tool  T3 course-daily skill+cmd  T4 /daily-setup+/daily-uninstall  T5 live run+docs.
(The commands/calendar-sync.md gcloud-hint fix is in the diff base 8e0914d — already on main via an earlier branch, NOT an e-daily commit.)
T1: NOT started.

E T1: complete. daily_brief.py + CLI (3d5518c) + review (sonnet, needs-work) + fixes (3b6701e: resilience/dedupe/minors). pytest 188. Reviewer's 3 approved deviations kept (datetime _parse, _prereads_for title-session match, now.timestamp staleness).

E T2: complete. daily_brief MCP tool (e4fee67), verbatim from brief. vitest 24. No per-task review (pure transcription of reviewed+corrected plan code).

E T3: complete. course-daily skill + /course-daily command (e769e91), verbatim from brief. Markdown; live-verified in T5.

E T4: complete (1dfa64e) — /daily-setup + /daily-uninstall, verbatim.
E T5: daily-brief CLI live-verified (4 classes, title-preread match worked, scrapeStale false); digest+notify hand-run. launchd/plugin end-to-end = USER step (plugin not installed here). Docs + README updated (862e97c).
ALL 5 E TASKS DONE. pytest 188, vitest 24, tsc/build clean. Ready for whole-branch review.

E whole-branch review (opus): "With fixes" — no Critical, 3 Important + minors. Fixed d2c5d51 (scrapeStale _STALE_HOURS constant; plist --allowedTools split Bash(cd:*)+Bash(uv run...); skill pre-read path composition; per-dir try/except; stderr traces). pytest 189, vitest 24. Ready to merge.
## F — dashboard. Branch f-dashboard off main. Spec .../2026-09-08-dashboard-design.md, plan .../2026-09-08-dashboard.md (5 tasks).
T1 python transcribe-url+--inbox  T2 dashboard/server  T3 dashboard/web  T4 glue+CI  T5 live run.
T1: NOT started.
T1: complete (3e3369b, review Approved). Minors deferred: _write_url_transcript omits course: key (harmless, ingest overrides); test_cli_transcribe_url_dispatch mocks transcribe_url so arg-threading untested; whisper_raises test does not pin error string.
T2: complete (b20e1d6 + fixes a21cdf5). Review Needs-work -> 3 Important fixed (upload path-traversal, SSE leak/crash, Host/Origin guard) + minors. server vitest 25.
T3: complete (39a7055 + fixes 3600fb1). Review Approved -> fixed 2 freeze bugs (reload-mid-job, SSE drop), Tabler webfont, --color-accent, minors. web vitest 6.
DEFER to whole-branch: Tabler webfont adds ~4MB to dist/ (ttf 2.8MB) - subset or self-host 6 glyphs if it matters. dashboard/web has no tsc typecheck (T4 should add to check + CI).
T4: complete (05cb0d6). Glue: dashboard/ aggregator workspace, root dashboard scripts, /mesa:ares-brain-dashboard command, CI dashboard job, eslint dashboard/** glob + web tsc check. npm run check CLEAN (0 errors, 10 scoped no-explicit-any warnings). Pre-commit hook ran normally.
