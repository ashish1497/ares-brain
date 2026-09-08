# D-oauth — Calendar Auth Revision Design

**Date:** 2026-09-03
**Status:** Draft for review
**Scope:** A targeted revision of sub-project D (calendar sync, merged @ `ce81733`). Replaces the gcloud Application Default Credentials auth path with the user's own Desktop OAuth client via `InstalledAppFlow`. Nothing else in D changes.

---

## 1. Why

D's `calendar_sync.py` `_service()` authenticated via `google.auth.default()` (gcloud ADC). Google restricts the gcloud OAuth client's access to the Calendar API scope for both Workspace and personal accounts — `gcloud auth application-default login --scopes=.../auth/calendar` is rejected ("cloud-platform scope required") or hard-blocked ("this app is blocked"). ADC is not a viable path for the Calendar scope for this user.

The user has created their own **Desktop-type OAuth 2.0 client** in a GCP project (Calendar API enabled, consent screen External/Testing, self added as a test user) and placed `client_secret.json` at the repo root (gitignored). Testing-mode apps with the user as a test user bypass Google's verification wall.

## 2. Locked cross-cutting decisions (still binding)

- Python sidecar; MCP tool + slash command drive it. No LLM.
- `calendar_sync.py` imports stay: stdlib + `google.*` (lazy, inside functions) + `from paths import ...`. **No `scrape_steps` import.**
- `.env` never read/printed/committed. D-oauth does not use `.env`.
- `client_secret.json` and `token.json` are secrets — gitignored (already done), chmod 600 on write.
- Every step idempotent; one failure never aborts a run.

## 3. Decisions (this revision)

| Question          | Decision                                                                                                                                                                                                                                                                                                                                                             |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth mechanism    | `google_auth_oauthlib.flow.InstalledAppFlow` with the user's Desktop `client_secret.json`. Cached `token.json` (authorized-user JSON) after one consent.                                                                                                                                                                                                             |
| Scopes            | `["https://www.googleapis.com/auth/calendar"]` only. Drop `cloud-platform` (a gcloud-only requirement).                                                                                                                                                                                                                                                              |
| First-run consent | A dedicated interactive `calendar-auth` CLI subcommand: `cd scraper && uv run python lms_scrape.py calendar-auth`. Opens a browser (`run_local_server(port=0)`), user consents, `token.json` written. `/calendar-sync` and the `calendar_sync` MCP tool NEVER open a browser — with no/invalid token they return `status: "needs-auth"` pointing at `calendar-auth`. |
| File locations    | `client_secret.json` / `token.json` at the repo root by default; `GOOGLE_CLIENT_SECRET` / `GOOGLE_TOKEN` env vars override. Resolved via `paths.HOME`.                                                                                                                                                                                                               |
| Unchanged         | `build_desired_events`, `canonical`/`_hash`, `reconcile`, `run()`, `courses/_calendar.json` state, `ensure_calendar`, `_is_auth_error` classification, the `calendar_sync` MCP tool, the `/calendar-sync` command. `AUTH_HINT` text changes to name `calendar-auth`.                                                                                                 |
| MCP               | No new MCP tool. `calendar-auth` is interactive-only (browser) → CLI + README only.                                                                                                                                                                                                                                                                                  |

## 4. `calendar_sync.py` changes

```python
_SCOPES = ["https://www.googleapis.com/auth/calendar"]
AUTH_HINT = ("run once:  cd scraper && uv run python lms_scrape.py calendar-auth\n"
             "(needs a Desktop-type OAuth client_secret.json at the repo root)")


def _client_secret_path() -> Path:
    return Path(os.environ.get("GOOGLE_CLIENT_SECRET") or (HOME / "client_secret.json"))


def _token_path() -> Path:
    return Path(os.environ.get("GOOGLE_TOKEN") or (HOME / "token.json"))
```

(`HOME` = `paths.HOME` — already imported. `import os` — already imported.)

### `_service() -> service | None`

1. `_token_path()` missing → `None`.
2. `from google.oauth2.credentials import Credentials`; `creds = Credentials.from_authorized_user_file(str(_token_path()), _SCOPES)`.
   - On any exception (malformed file, scope mismatch) → `None`.
3. `if creds.valid:` build and return the service.
4. `elif creds.expired and creds.refresh_token:` `from google.auth.transport.requests import Request; creds.refresh(Request())` → rewrite `_token_path()` with `creds.to_json()` (chmod 600) → build and return.
   - On `RefreshError` / any exception → `None`.
5. Else → `None`.
6. Build: `from googleapiclient.discovery import build; return build("calendar", "v3", credentials=creds, cache_discovery=False)` — on exception `print(..., file=sys.stderr); return None`.

### `do_auth() -> dict`

- `cs = _client_secret_path()`; if missing → `{"status": "error", "hint": "no client_secret.json at <path> — download a Desktop OAuth client from GCP Console"}`.
- Load the JSON; if it has no `"installed"` key (e.g. it's a `"web"` client) → `{"status": "error", "hint": "client_secret.json is a '<type>' client — create an OAuth client of type 'Desktop app' instead"}`.
- `from google_auth_oauthlib.flow import InstalledAppFlow`
- `flow = InstalledAppFlow.from_client_secrets_file(str(cs), _SCOPES)`
- `creds = flow.run_local_server(port=0)` (opens the browser, blocks until consent)
- `_token_path().write_text(creds.to_json())`; `os.chmod(_token_path(), 0o600)`
- Return `{"status": "ok", "token": str(_token_path()), "scopes": _SCOPES}`.
- Wrap the flow in try/except → `{"status": "error", "hint": str(exc)}` (never raise out).

## 5. `lms_scrape.py` change

New subparser + dispatch (no `--json` — it's interactive, prints a human line):

```python
    sub.add_parser("calendar-auth")
    ...
    if args.cmd == "calendar-auth":
        import calendar_sync as _cs
        r = _cs.do_auth()
        print(json.dumps(r, indent=1))
        return r
```

## 6. requirements

`scraper/requirements.txt` += `google-auth-oauthlib>=1.2.0`.

## 7. README

Replace the "Calendar" setup steps: create a GCP project → enable Google Calendar API → OAuth consent screen (External, Testing, add your Gmail as a test user) → Credentials → Create OAuth client ID → **Desktop app** → download JSON → save as `client_secret.json` at the repo root. Then `cd scraper && uv run python lms_scrape.py calendar-auth` (browser consent, once). Then `/calendar-sync`.

## 8. Testing

- **`_service()`:** no token file → `None`. A fake authorized-user `token.json` with a far-future expiry + `_creds_from_file` monkeypatched to return a `valid` fake → builds (monkeypatch `googleapiclient.discovery.build` to a sentinel). Expired + `refresh_token` present, `Credentials.refresh` monkeypatched to flip `.valid` true → `token.json` rewritten, service built. Expired + no `refresh_token` → `None`. Malformed token file → `None`.
- **`do_auth()`:** `client_secret.json` absent → `{status: "error"}`. A `{"web": {...}}` file → `{status: "error", hint contains "Desktop"}`. A `{"installed": {...}}` file + `InstalledAppFlow.from_client_secrets_file` monkeypatched to a fake flow whose `run_local_server` returns a fake creds object with `.to_json()` → `token.json` written, mode `600`, `{status: "ok"}`.
- **`calendar-auth` subcommand:** dispatch calls `do_auth`, prints the dict.
- **No regression:** the existing `test_calendar_sync.py` suite (auth-error classification, reconcile, build_desired_events, ensure_calendar, import isolation) stays green — `_is_auth_error` and everything downstream of `_service()` is untouched. The `test_service_none_without_creds` test is rewritten for the new "no token file" path.
- **Live run:** user runs `calendar-auth` (real browser, personal Gmail) → `token.json` appears. `calendar-sync --dry-run` → a real plan (created counts for the ~5 upcoming assignment/exam events). `calendar-sync` → "Mesa Assignments" calendar created + events with 24h/2h reminders. `calendar-sync` again → all `unchanged`, zero API mutations. Eyeball one event in Google Calendar for the right IST time. Record in `docs/lms-api.md`.

## 9. Build order

One task. `_client_secret_path`/`_token_path` + `_service` rewrite + `do_auth` + `calendar-auth` subcommand + `requirements` + README + tests + live run.

## 10. Open items

1. **`run_local_server` port:** `port=0` picks a free port; the redirect URI Google needs is `http://localhost` (Desktop clients allow any localhost port automatically — no redirect URI to register). If Google rejects the redirect, fall back to `run_console()` (deprecated but works) and note it.
2. **Token revocation:** if the user revokes access in their Google account, `_service()` gets a `RefreshError` → `None` → `needs-auth` → they re-run `calendar-auth`. No explicit handling needed.
3. **Multiple Google accounts:** `calendar-auth` uses whichever account the user picks in the browser. The "Mesa Assignments" calendar lives on that account. Switching accounts = delete `token.json`, re-run `calendar-auth`. A `--reauth` flag could force the account picker later.
