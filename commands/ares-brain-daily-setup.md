---
description: Install the 6 AM launchd job that runs /mesa:ares-brain-course-daily.
---

Prereq: this plugin must be installed so `claude -p` can resolve the skill —
`cd mcp && npm install && npm run build`, then from the repo's parent dir
`claude plugin marketplace add ./ares-brain` and
`claude plugin install mesa@mesa-local`. The plugin is a
_cache copy_: after any repo change, refresh it with
`claude plugin uninstall mesa@mesa-local && claude plugin marketplace update mesa-local && claude plugin install mesa@mesa-local`.

Install the daily agent. Steps:

1. `REPO=$(git rev-parse --show-toplevel)` and `CLAUDE=$(which claude)`. If `claude`
   is not on PATH, ask the user for its absolute path and stop until they give it.
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
       <string>Bash(cd:*),Bash(uv run python lms_scrape.py:*),Bash(osascript:*),Write(daily/**),Read(courses/**),mcp__plugin_mesa_mesa__daily_brief,mcp__plugin_mesa_mesa__calendar_sync,mcp__plugin_mesa_mesa__scrape,mcp__plugin_mesa_mesa__ingest</string>
     </array>
     <key>StartCalendarInterval</key><dict><key>Hour</key><integer>6</integer><key>Minute</key><integer>0</integer></dict>
     <key>StandardOutPath</key><string><REPO>/daily/_launchd.log</string>
     <key>StandardErrorPath</key><string><REPO>/daily/_launchd.log</string>
     <key>RunAtLoad</key><false/>
   </dict></plist>
   ```

4. `launchctl unload ~/Library/LaunchAgents/co.mesa.ares-brain.daily.plist 2>/dev/null; launchctl load ~/Library/LaunchAgents/co.mesa.ares-brain.daily.plist`

   `launchctl load`/`unload` are deprecated on recent macOS but still work today.
   The modern equivalents are
   `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/co.mesa.ares-brain.daily.plist`
   and `launchctl bootout gui/$(id -u)/co.mesa.ares-brain.daily`.

5. Tell the user: the job path, that it runs at 06:00 local, `daily/_launchd.log` for
   output, `launchctl start co.mesa.ares-brain.daily` to trigger a run now, and
   `/mesa:ares-brain-daily-uninstall` to remove it.

If `claude -p` prompted for a tool during the first real run (visible in the log),
widen the `--allowedTools` string minimally and re-write + reload the plist.

The `Write(daily/**)` and `Read(courses/**)` entries are relative to `WorkingDirectory`
(the repo), so they only line up while `ARES_BRAIN_HOME` is unset (its default). If the
user has pointed `ARES_BRAIN_HOME` elsewhere, widen those two entries to the absolute
paths of that location's `daily/` and `courses/`.
