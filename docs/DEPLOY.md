# Deployment guide

This agent is **local and single-user by design**. It holds your Mesa session token,
writes to your Google Calendar, and spends your Claude subscription. There is no
server component and no multi-tenant story. "Deploy" here means one of:

1. Run it on a schedule on the Mac you already use.
2. Set it up on a second machine (new laptop, or a friend on the course).
3. Run the unattended pieces on a headless box.

Nothing below requires code changes.

---

## 1. Scheduled on your own Mac (the normal case)

Already built. Recap of the moving parts:

| Piece                | Where                                                     | Refresh trigger                                                  |
| -------------------- | --------------------------------------------------------- | ---------------------------------------------------------------- |
| Mesa token           | `.env` → `MESA_REFRESH_TOKEN`                             | auto-rotates each scrape; re-paste if locked out (~30 days idle) |
| Calendar auth        | `client_secret.json` + `token.json` (repo root)           | `token.json` auto-refreshes; re-run `calendar-auth` if revoked   |
| CLI auth for the job | `claude setup-token` (keychain / `~/.claude`)             | long-lived; re-run if it stops working                           |
| The job              | `~/Library/LaunchAgents/co.mesa.course-agent.daily.plist` | `/daily-setup` rewrites it                                       |

Setup order: install plugin → `calendar-auth` → `claude setup-token` → `/daily-setup`
→ `launchctl kickstart -k gui/$(id -u)/co.mesa.course-agent.daily` → read
`daily/_launchd.log`.

**Watch out for:**

- **Two `claude` binaries.** The desktop app bundles its own; the launchd job uses
  whichever `claude` is on `PATH` (usually the Homebrew one). They have separate auth.
  `which claude` in a login shell is what the job gets; that install needs
  `claude setup-token`.
- **Mac asleep at 06:00.** `launchd` runs the job at next wake. A fully-off Mac skips
  the day — there is no catch-up. If that matters, add a second
  `StartCalendarInterval` entry for a later hour.
- **Plugin is a cache copy.** After any `git pull` in the repo, the installed plugin is
  stale until you re-run the uninstall / marketplace-update / install trio (see README).
  The launchd job loads the _cached_ skill, not your working tree.
  - Alternative that dodges this entirely: point the plist at a shell script that runs
    the scraper CLI directly from the git checkout (`cd <repo>/scraper && uv run python
lms_scrape.py all`, then `calendar-sync`, then your own digest step). You lose the
    LLM-written "mindset" paragraph but the job always runs current code.

---

## 2. Second machine / another student

Full replay of the README **Install** section on the new machine:

1. `git clone` the repo.
2. `cd scraper && uv venv --python 3.12 .venv && uv pip install -r requirements.txt`
3. `cd mcp && npm install && npm run build`
4. `cp .env.example .env` → paste **their own** `MESA_REFRESH_TOKEN`.
5. `claude plugin marketplace add ./course-agent` (from the parent dir) →
   `claude plugin install mesa-course-agent@mesa-course-agent-local`.
6. Calendar: **their own** GCP project + Desktop OAuth client → `client_secret.json` →
   `calendar-auth`. The OAuth consent screen must list their Google account as a test
   user. One client per person; do not share `token.json`.
7. Optional: `claude setup-token` + `/daily-setup`.

Per-person, never shared: `.env`, `client_secret.json`, `token.json`, the whole
`courses/` and `daily/` tree.

The repo can be shared (it's just code + docs + design). Everything user-specific is
gitignored already — confirm with `git status` before pushing anywhere.

---

## 3. Headless box (Linux server, always-on Mac mini, cloud VM)

Works for the deterministic pipeline; two things need adapting.

### What runs as-is

`lms_scrape.py {all, ingest, brain-index, calendar-sync, daily-brief}` — pure Python,
no GUI. Schedule with `cron` instead of `launchd`:

```
0 6 * * *  cd /path/to/course-agent/scraper && COURSE_AGENT_HOME=/path/to/course-agent /path/to/uv run python lms_scrape.py all >> /path/to/course-agent/daily/_cron.log 2>&1
```

Add a second line for `calendar-sync`. For the prose digest, run
`claude -p "/mesa-course-agent:course-daily"` from cron (needs `claude` + a
`setup-token` on that box).

### What needs adapting

- **`calendar-auth` opens a browser.** A headless box has none. Do the OAuth on a
  laptop (same `client_secret.json`), then copy the resulting `token.json` to the
  server's repo root, `chmod 600`. It refreshes itself from there.
  - If the box literally cannot reach a browser even once and file-copy is not an
    option, the fallback is `flow.run_console()` — but that path is not wired in; it
    would be a small code change to `calendar_sync.do_auth()`.
- **`osascript` notifications are macOS-only.** On Linux the digest still gets written
  to `daily/<date>.md`; the notification step just fails harmlessly (the skill tolerates
  it). To actually get pinged, replace the notify step with a curl to a Slack/Discord
  webhook or a `mail` command — that lives in `skills/course-daily/SKILL.md` step 5,
  so it is a docs/skill edit, not core code.

---

## 4. Secrets checklist

| File                 | Contains                            | Rule                                                    |
| -------------------- | ----------------------------------- | ------------------------------------------------------- |
| `.env`               | `MESA_REFRESH_TOKEN` (LMS session)  | gitignored; `chmod 600`; never paste in chat or commits |
| `client_secret.json` | Google OAuth **Desktop** client     | gitignored; `chmod 600`                                 |
| `token.json`         | Google OAuth access + refresh token | gitignored; written `chmod 600` automatically           |
| `.token.lock`        | scraper flock file                  | gitignored; safe to delete when no scrape is running    |

`.gitignore` already covers all of these plus `courses/`, `daily/`, `**/client_secret.json`,
`**/token.json`. Before pushing the repo anywhere, run `git status --porcelain` and
confirm none of them appear.

Rotating a leaked secret:

- LMS token: log out of Nexus everywhere, log back in, grab the new cookie, replace
  `MESA_REFRESH_TOKEN`.
- Google: GCP Console → Credentials → delete the OAuth client → make a new Desktop
  client → replace `client_secret.json` → `rm token.json` → `calendar-auth` again.

---

## 5. Cost and rate limits

- The 6 AM job = one scrape + one `calendar-sync` (cheap, deterministic) + one
  `claude -p` run that writes the digest (a handful of tool calls + one synthesis).
  Roughly one modest Claude Code turn per day.
- `/course-brain` does real synthesis over a whole course corpus. Running it for all
  ~17 courses in one sitting is the single most expensive thing here — do it in
  batches, or only for the courses you actually study from.
- `/course-ingest` transcription is CPU/time, not Claude cost: ~19 min per full session
  recording on Apple Silicon. Never put it in the scheduled job.
- A stale `MESA_REFRESH_TOKEN` makes the scrape step fail fast (auth error) — the job
  still writes a digest from existing data with a "re-scrape" banner, so a dead token
  degrades gracefully rather than breaking the pipeline.

---

## 6. Out of scope — do not deploy as

- A shared/multi-user service. One token, one calendar, one person.
- Anything public-facing or hosted. It has no auth layer of its own.
- A way to redistribute Mesa course material. The `courses/` tree is copyrighted
  coursework — keep it local, keep it gitignored, don't publish it.
