---
description: Remove the 6 AM morning-brief and 6 PM evening-check launchd jobs.
---

Run:

```
launchctl unload ~/Library/LaunchAgents/co.mesa.ares-brain.daily.plist 2>/dev/null
rm -f ~/Library/LaunchAgents/co.mesa.ares-brain.daily.plist
launchctl unload ~/Library/LaunchAgents/co.mesa.ares-brain.evening.plist 2>/dev/null
rm -f ~/Library/LaunchAgents/co.mesa.ares-brain.evening.plist
```

Confirm both are gone with `launchctl list | grep mesa` (expect no output). `daily/`
files are left in place.
