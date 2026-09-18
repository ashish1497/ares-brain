---
description: Install the 6 AM morning-brief and 6 PM evening-check launchd jobs.
---

Prereq: this plugin must be installed so `claude -p` can resolve the skills —
`cd mcp && npm install && npm run build`, then from the repo's parent dir
`claude plugin marketplace add ./ares-brain` and
`claude plugin install mesa@mesa-local`. The plugin is a
_cache copy_: after any repo change, refresh it with
`claude plugin uninstall mesa@mesa-local && claude plugin marketplace update mesa-local && claude plugin install mesa@mesa-local`.

Install both daily agents (morning brief at 06:00, evening check at 18:00). Steps:

1. `REPO=$(git rev-parse --show-toplevel)` and `CLAUDE=$(which claude)`. If `claude`
   is not on PATH, ask the user for its absolute path and stop until they give it.
   Also capture `PATH=$(which uv | xargs dirname):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`
   for `<PATH>` below — launchd jobs get a bare `PATH` (`/usr/bin:/bin:/usr/sbin:/sbin`),
   so without this the `uv run` step inside the skill can't find `uv`.
2. `mkdir -p "$REPO/daily"`.
3. Write `~/Library/LaunchAgents/co.mesa.ares-brain.daily.plist` with EXACTLY this
   content, substituting `<REPO>` and `<CLAUDE>`:

   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0"><dict>
     <key>Label</key><string>co.mesa.ares-brain.daily</string>
     <key>WorkingDirectory</key><string><REPO></string>
     <key>ProgramArguments</key><array>
       <string><CLAUDE></string>
       <string>-p</string><string>/mesa:ares-brain-course-daily</string>
       <string>--permission-mode</string><string>acceptEdits</string>
       <string>--allowedTools</string>
       <string>Bash(cd:*),Bash(uv run python lms_scrape.py:*),Bash(osascript:*),Write(daily/**),Write(courses/**/brain/drill.json),Read(courses/**),mcp__plugin_mesa_mesa__daily_brief,mcp__plugin_mesa_mesa__calendar_sync,mcp__plugin_mesa_mesa__scrape,mcp__plugin_mesa_mesa__ingest,mcp__plugin_mesa_mesa__brain_status,mcp__plugin_mesa_mesa__brain_get,mcp__plugin_mesa_mesa__brain_query</string>
     </array>
     <key>EnvironmentVariables</key>
     <dict><key>PATH</key><string><PATH></string></dict>
     <key>StartCalendarInterval</key><dict><key>Hour</key><integer>6</integer><key>Minute</key><integer>0</integer></dict>
     <key>StandardOutPath</key><string><REPO>/daily/_launchd.log</string>
     <key>StandardErrorPath</key><string><REPO>/daily/_launchd.log</string>
     <key>RunAtLoad</key><false/>
   </dict></plist>
   ```

4. Write `~/Library/LaunchAgents/co.mesa.ares-brain.evening.plist` with EXACTLY this
   content, substituting `<REPO>` and `<CLAUDE>`:

   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0"><dict>
     <key>Label</key><string>co.mesa.ares-brain.evening</string>
     <key>WorkingDirectory</key><string><REPO></string>
     <key>ProgramArguments</key><array>
       <string><CLAUDE></string>
       <string>-p</string><string>/mesa:ares-brain-course-evening</string>
       <string>--permission-mode</string><string>acceptEdits</string>
       <string>--allowedTools</string>
       <string>Bash(cd:*),Bash(uv run python lms_scrape.py:*),Bash(osascript:*),Write(daily/**),Read(courses/**),mcp__plugin_mesa_mesa__daily_brief,mcp__plugin_mesa_mesa__calendar_sync,mcp__plugin_mesa_mesa__scrape,mcp__plugin_mesa_mesa__ingest</string>
     </array>
     <key>EnvironmentVariables</key>
     <dict><key>PATH</key><string><PATH></string></dict>
     <key>StartCalendarInterval</key><dict><key>Hour</key><integer>18</integer><key>Minute</key><integer>0</integer></dict>
     <key>StandardOutPath</key><string><REPO>/daily/_launchd.log</string>
     <key>StandardErrorPath</key><string><REPO>/daily/_launchd.log</string>
     <key>RunAtLoad</key><false/>
   </dict></plist>
   ```

5. Load both:

   ```
   launchctl unload ~/Library/LaunchAgents/co.mesa.ares-brain.daily.plist 2>/dev/null
   launchctl load ~/Library/LaunchAgents/co.mesa.ares-brain.daily.plist
   launchctl unload ~/Library/LaunchAgents/co.mesa.ares-brain.evening.plist 2>/dev/null
   launchctl load ~/Library/LaunchAgents/co.mesa.ares-brain.evening.plist
   ```

   `launchctl load`/`unload` are deprecated on recent macOS but still work today.
   The modern equivalents are
   `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/co.mesa.ares-brain.<daily|evening>.plist`
   and `launchctl bootout gui/$(id -u)/co.mesa.ares-brain.<daily|evening>`.

6. Tell the user: both job paths, that they run at 06:00 and 18:00 local, that
   `daily/_launchd.log` holds output for both (Label line disambiguates), that
   `launchctl start co.mesa.ares-brain.daily` / `co.mesa.ares-brain.evening` trigger
   a run now, and `/mesa:ares-brain-daily-uninstall` removes both.

If `claude -p` prompted for a tool during the first real run (visible in the log),
widen the `--allowedTools` string minimally on the affected plist and re-write + reload it.

The `Write(daily/**)` and `Read(courses/**)` entries are relative to `WorkingDirectory`
(the repo), so they only line up while `ARES_BRAIN_HOME` is unset (its default). If the
user has pointed `ARES_BRAIN_HOME` elsewhere, widen those two entries (on both plists) to
the absolute paths of that location's `daily/` and `courses/`.

**Headless login:** both jobs run `claude -p` non-interactively — this needs Claude
Code's own CLI session to be logged in (separate from the Mesa LMS token). If a run's
log shows `Not logged in` / an OAuth error, run `claude /login` once from an interactive
terminal, then trigger the job again to confirm.
