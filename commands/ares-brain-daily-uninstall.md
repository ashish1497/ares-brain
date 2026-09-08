---
description: Remove the 6 AM launchd job.
---

Run:
`launchctl unload ~/Library/LaunchAgents/co.mesa.ares-brain.daily.plist 2>/dev/null; rm -f ~/Library/LaunchAgents/co.mesa.ares-brain.daily.plist`

Confirm it's gone with `launchctl list | grep mesa` (expect no output). `daily/` files
are left in place.
