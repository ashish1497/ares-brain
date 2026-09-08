---
description: Start the local ares-brain dashboard and print its URL.
---

Start the dashboard:

1. `REPO=$(git rev-parse --show-toplevel)`.
2. If either `$REPO/dashboard/web/dist/index.html` or
   `$REPO/dashboard/server/dist/index.js` is missing, run
   `npm run --prefix "$REPO" dashboard:build`.
3. `nohup npm run --prefix "$REPO" --workspace ares-dashboard start > /tmp/ares-brain-dashboard.log 2>&1 &`
4. Poll `http://127.0.0.1:4319/api/courses` (up to ~10s) until it answers.
5. Tell the user: open `http://127.0.0.1:4319`, logs at `/tmp/ares-brain-dashboard.log`,
   stop it with `pkill -f ares-dashboard-server`.

It binds `127.0.0.1` only. One long job (scrape / transcribe) runs at a time; the page
streams its log. Chat is phase 2. `ARES_BRAIN_DASHBOARD_PORT` overrides the port.
