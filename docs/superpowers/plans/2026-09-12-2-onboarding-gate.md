# Onboarding Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The dashboard serves nothing but a setup screen until four checks
pass: Drive OAuth connected, Calendar OAuth connected, Mesa refresh token
present, and `claude -p` is logged in.

**Architecture:** A Python `setup_state.check_setup()` reports the three
Python-checkable items; the dashboard server's `GET /api/setup-state` route
combines that with its own `claude -p` probe into one four-flag response.
Every other dashboard route (except `/setup`'s own API) 403s while any flag
is false. The web app renders a blocking `SetupGate` screen until all four
are true.

**Tech Stack:** Python (`scraper/`), TypeScript (`dashboard/server`,
`dashboard/web`).

**Spec:** `docs/superpowers/specs/2026-09-12-collaborative-multi-student-design.md`
(section C.2). Depends on Build-order item 1 (`google_auth.py`). Implements
Build-order item 2.

## Global Constraints

- Four flags, exact names: `driveConnected`, `calendarConnected`,
  `mesaTokenPresent`, `claudeCliLoggedIn`.
- `driveConnected`/`calendarConnected` check the SAME `token.json` (one
  combined OAuth token per Task 1's plan) — they are not two separate
  tokens, just two scope checks against one credential.
- Gate blocks by returning a 200 whose body the web SPA router treats as
  "render setup only" — NOT a blanket 403 on every route, so the setup
  screen's own polling/actions keep working. (Scattered 403s were the
  spec's initial draft language; this plan corrects that to match how the
  existing `guardOrigin` 403 pattern is used only for origin checks, not
  feature-gating.)
- `claude -p` probe must be non-mutating and must not hang the setup-state
  endpoint if `claude` itself hangs — hard-cap it (5s timeout, matching
  the timeout pattern already used in `runPythonJSON`).

---

### Task 1: `setup_state.py` — Python-checkable flags

**Files:**

- Create: `scraper/setup_state.py`
- Test: `scraper/tests/test_setup_state.py`

**Interfaces:**

- Consumes: `google_auth.token_path()`, `google_auth.SCOPES` (Task 1 of the
  auth-foundation plan), `.env`'s `MESA_REFRESH_TOKEN` (via the same
  dotenv-loading pattern `mesa_api.py` already uses — see
  `mesa_api.load_config`/`.env` reads).
- Produces: `check_setup() -> dict` — `{"driveConnected": bool,
"calendarConnected": bool, "mesaTokenPresent": bool}` (three keys only;
  `claudeCliLoggedIn` is added by the dashboard server in Task 3, not here
  — Python has no business probing the `claude` CLI).

- [ ] **Step 1: Write the failing tests**

```python
# scraper/tests/test_setup_state.py
import json
from pathlib import Path
import setup_state as ss


def test_all_false_with_no_token_and_no_env(tmp_path, monkeypatch):
    monkeypatch.setenv("GOOGLE_TOKEN", str(tmp_path / "missing.json"))
    monkeypatch.delenv("MESA_REFRESH_TOKEN", raising=False)
    monkeypatch.setattr(ss, "_env_path", lambda: tmp_path / "missing.env")
    result = ss.check_setup()
    assert result == {
        "driveConnected": False,
        "calendarConnected": False,
        "mesaTokenPresent": False,
    }


def test_calendar_and_drive_true_when_token_has_both_scopes(tmp_path, monkeypatch):
    token_file = tmp_path / "token.json"
    token_file.write_text(json.dumps({
        "token": "x", "refresh_token": "y", "client_id": "z", "client_secret": "w",
        "scopes": [
            "https://www.googleapis.com/auth/calendar",
            "https://www.googleapis.com/auth/drive.file",
        ],
    }))
    monkeypatch.setenv("GOOGLE_TOKEN", str(token_file))
    result = ss.check_setup()
    assert result["driveConnected"] is True
    assert result["calendarConnected"] is True


def test_drive_false_when_only_calendar_scope_present(tmp_path, monkeypatch):
    token_file = tmp_path / "token.json"
    token_file.write_text(json.dumps({
        "token": "x", "refresh_token": "y", "client_id": "z", "client_secret": "w",
        "scopes": ["https://www.googleapis.com/auth/calendar"],
    }))
    monkeypatch.setenv("GOOGLE_TOKEN", str(token_file))
    result = ss.check_setup()
    assert result["driveConnected"] is False
    assert result["calendarConnected"] is True


def test_mesa_token_present_from_env_file(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text("MESA_REFRESH_TOKEN=abc123\n")
    monkeypatch.setattr(ss, "_env_path", lambda: env_file)
    monkeypatch.setenv("GOOGLE_TOKEN", str(tmp_path / "missing.json"))
    result = ss.check_setup()
    assert result["mesaTokenPresent"] is True


def test_mesa_token_absent_when_placeholder(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text("MESA_REFRESH_TOKEN=changeme\n")
    monkeypatch.setattr(ss, "_env_path", lambda: env_file)
    monkeypatch.setenv("GOOGLE_TOKEN", str(tmp_path / "missing.json"))
    result = ss.check_setup()
    assert result["mesaTokenPresent"] is False
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd scraper && uv run pytest tests/test_setup_state.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'setup_state'`

- [ ] **Step 3: Write `setup_state.py`**

```python
"""Onboarding-gate checks: does this install have everything it needs
before the dashboard should open? No LLM, no LMS contact — reads the same
token.json google_auth.py owns, plus .env, off disk."""
import json
import os
from pathlib import Path

import google_auth
from paths import HOME

_PLACEHOLDERS = {"", "changeme", "your_token_here"}


def _env_path() -> Path:
    return HOME / ".env"


def _token_scopes() -> set[str]:
    if not google_auth.token_path().exists():
        return set()
    try:
        data = json.loads(google_auth.token_path().read_text())
    except (OSError, json.JSONDecodeError):
        return set()
    return set(data.get("scopes") or [])


def _mesa_token_present() -> bool:
    val = os.environ.get("MESA_REFRESH_TOKEN", "").strip()
    if val and val.lower() not in _PLACEHOLDERS:
        return True
    p = _env_path()
    if not p.exists():
        return False
    for line in p.read_text().splitlines():
        if line.strip().startswith("MESA_REFRESH_TOKEN="):
            v = line.split("=", 1)[1].strip().strip('"').strip("'")
            return bool(v) and v.lower() not in _PLACEHOLDERS
    return False


def check_setup() -> dict:
    scopes = _token_scopes()
    return {
        "driveConnected": "https://www.googleapis.com/auth/drive.file" in scopes,
        "calendarConnected": "https://www.googleapis.com/auth/calendar" in scopes,
        "mesaTokenPresent": _mesa_token_present(),
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd scraper && uv run pytest tests/test_setup_state.py -v`
Expected: PASS (5/5)

- [ ] **Step 5: Wire the CLI subcommand**

Add to `scraper/lms_scrape.py`'s subparser section:

```python
sub.add_parser("setup-state")
```

And in the dispatch section:

```python
if args.cmd == "setup-state":
    import setup_state as _ss
    result = _ss.check_setup()
    print(json.dumps(result) if args.json else json.dumps(result, indent=1))
    return result
```

- [ ] **Step 6: Verify the CLI**

Run: `cd scraper && uv run python lms_scrape.py setup-state --json`
Expected: prints `{"driveConnected": false, "calendarConnected": false, "mesaTokenPresent": false}` (or `true`s if this dev machine already has a token/`.env` — either is fine, just confirm valid JSON with the three keys)

- [ ] **Step 7: Commit**

```bash
git add scraper/setup_state.py scraper/tests/test_setup_state.py scraper/lms_scrape.py
git commit -m "feat: add setup_state.check_setup + setup-state CLI subcommand"
```

---

### Task 2: `claude` CLI probe (dashboard server)

**Files:**

- Create: `dashboard/server/src/lib/claudeProbe.ts`
- Test: `dashboard/server/test/claudeProbe.test.ts`

**Interfaces:**

- Produces: `probeClaudeCli(timeoutMs?: number): Promise<boolean>` — spawns
  `claude -p "/__ares_brain_setup_probe__"` (a skill name guaranteed not to
  exist), resolves `true` if stderr/stdout does NOT contain "Not logged in"
  or "revoked", `false` otherwise (including on timeout or spawn error).

- [ ] **Step 1: Write the failing tests**

```typescript
// dashboard/server/test/claudeProbe.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

import { spawn } from "node:child_process";
import { probeClaudeCli } from "../src/lib/claudeProbe.js";
import { EventEmitter } from "node:events";

function fakeChild(stdoutText: string) {
  const child: any = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  setImmediate(() => {
    child.stdout.emit("data", Buffer.from(stdoutText));
    child.emit("close", 0);
  });
  return child;
}

describe("probeClaudeCli", () => {
  it("resolves true when output has no auth-failure markers", async () => {
    (spawn as any).mockReturnValue(fakeChild("Unknown skill: __ares_brain_setup_probe__\n"));
    expect(await probeClaudeCli()).toBe(true);
  });

  it("resolves false when output says Not logged in", async () => {
    (spawn as any).mockReturnValue(fakeChild("Not logged in · Please run /login\n"));
    expect(await probeClaudeCli()).toBe(false);
  });

  it("resolves false when output says revoked", async () => {
    (spawn as any).mockReturnValue(
      fakeChild('{"error":{"message":"OAuth access token has been revoked."}}\n'),
    );
    expect(await probeClaudeCli()).toBe(false);
  });

  it("resolves false on spawn error", async () => {
    const child: any = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    (spawn as any).mockReturnValue(child);
    const p = probeClaudeCli(200);
    setImmediate(() => child.emit("error", new Error("ENOENT")));
    expect(await p).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd dashboard/server && npx vitest run test/claudeProbe.test.ts`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Write `claudeProbe.ts`**

```typescript
import { spawn } from "node:child_process";

const FAILURE_MARKERS = ["Not logged in", "revoked", "authentication_error"];

export function probeClaudeCli(timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    let out = "";
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const child = spawn("claude", ["-p", "/__ares_brain_setup_probe__"]);
    const t = setTimeout(() => {
      child.kill("SIGTERM");
      finish(false);
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", () => {
      clearTimeout(t);
      finish(false);
    });
    child.on("close", () => {
      clearTimeout(t);
      finish(!FAILURE_MARKERS.some((m) => out.includes(m)));
    });
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd dashboard/server && npx vitest run test/claudeProbe.test.ts`
Expected: PASS (4/4)

- [ ] **Step 5: Commit**

```bash
git add dashboard/server/src/lib/claudeProbe.ts dashboard/server/test/claudeProbe.test.ts
git commit -m "feat: add claude CLI login probe for the onboarding gate"
```

---

### Task 3: `GET /api/setup-state` route + gate enforcement

**Files:**

- Modify: `dashboard/server/src/index.ts`
- Test: `dashboard/server/test/setupGate.test.ts`

**Interfaces:**

- Consumes: `runPythonJSON(["setup-state", "--json"])` (existing helper,
  Task 1's CLI subcommand), `probeClaudeCli()` (Task 2)
- Produces: `GET /api/setup-state` → `{driveConnected, calendarConnected,
mesaTokenPresent, claudeCliLoggedIn, ready: boolean}` where `ready` is the
  AND of all four. Every other `/api/*` route (except `/api/setup-state`
  itself) returns `503 {error: "setup incomplete", setupState: {...}}` while
  `ready` is false.

- [ ] **Step 1: Write the failing tests**

```typescript
// dashboard/server/test/setupGate.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/lib/python.js", async () => {
  const actual =
    await vi.importActual<typeof import("../src/lib/python.js")>("../src/lib/python.js");
  return { ...actual, runPythonJSON: vi.fn() };
});
vi.mock("../src/lib/claudeProbe.js", () => ({ probeClaudeCli: vi.fn() }));

import { createServer } from "../src/index.js";
import { runPythonJSON } from "../src/lib/python.js";
import { probeClaudeCli } from "../src/lib/claudeProbe.js";
import type { Server } from "node:http";

let server: Server;
let base: string;

beforeEach(async () => {
  server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});

describe("setup gate", () => {
  it("GET /api/setup-state reports ready:false when anything is incomplete", async () => {
    (runPythonJSON as any).mockResolvedValue({
      ok: true,
      data: { driveConnected: false, calendarConnected: true, mesaTokenPresent: true },
    });
    (probeClaudeCli as any).mockResolvedValue(true);
    const res = await fetch(`${base}/api/setup-state`);
    const j = await res.json();
    expect(j.ready).toBe(false);
    expect(j.driveConnected).toBe(false);
  });

  it("GET /api/setup-state reports ready:true when all four pass", async () => {
    (runPythonJSON as any).mockResolvedValue({
      ok: true,
      data: { driveConnected: true, calendarConnected: true, mesaTokenPresent: true },
    });
    (probeClaudeCli as any).mockResolvedValue(true);
    const res = await fetch(`${base}/api/setup-state`);
    expect((await res.json()).ready).toBe(true);
  });

  it("blocks GET /api/courses with 503 while setup is incomplete", async () => {
    (runPythonJSON as any).mockResolvedValue({
      ok: true,
      data: { driveConnected: false, calendarConnected: false, mesaTokenPresent: false },
    });
    (probeClaudeCli as any).mockResolvedValue(false);
    const res = await fetch(`${base}/api/courses`);
    expect(res.status).toBe(503);
  });

  it("allows GET /api/courses through once setup is complete", async () => {
    (runPythonJSON as any).mockResolvedValue({
      ok: true,
      data: { driveConnected: true, calendarConnected: true, mesaTokenPresent: true },
    });
    (probeClaudeCli as any).mockResolvedValue(true);
    const res = await fetch(`${base}/api/courses`);
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd dashboard/server && npx vitest run test/setupGate.test.ts`
Expected: FAIL — route doesn't exist / gate doesn't block

- [ ] **Step 3: Add the route + gate to `index.ts`**

Add near the top of `handle()`, before any other route match:

```typescript
async function getSetupState() {
  const py = await runPythonJSON(["setup-state", "--json"]);
  const base = py.ok
    ? (py.data as {
        driveConnected: boolean;
        calendarConnected: boolean;
        mesaTokenPresent: boolean;
      })
    : { driveConnected: false, calendarConnected: false, mesaTokenPresent: false };
  const claudeCliLoggedIn = await probeClaudeCli();
  const ready =
    base.driveConnected && base.calendarConnected && base.mesaTokenPresent && claudeCliLoggedIn;
  return { ...base, claudeCliLoggedIn, ready };
}
```

Then in `handle()`:

```typescript
if (match("GET", "/api/setup-state", method, url)) {
  return json(res, 200, await getSetupState());
}

// Gate: every other /api/* route requires setup to be complete.
if (url.startsWith("/api/")) {
  const state = await getSetupState();
  if (!state.ready) return json(res, 503, { error: "setup incomplete", setupState: state });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd dashboard/server && npx vitest run test/setupGate.test.ts`
Expected: PASS (4/4)

- [ ] **Step 5: Run the FULL server test suite — this route sits in front of every other route**

Run: `cd dashboard/server && npx vitest run`
Expected: every existing test must still pass. If any fail because they now
hit the gate (state not mocked in that test file), that test needs
`vi.mock("../src/lib/python.js", ...)` extended to also stub `setup-state`
returning all-true, or a shared test helper — fix forward, don't weaken the
gate.

- [ ] **Step 6: Commit**

```bash
git add dashboard/server/src/index.ts dashboard/server/test/setupGate.test.ts
git commit -m "feat: gate every dashboard API route behind the onboarding checks"
```

---

### Task 4: `SetupGate` web component

**Files:**

- Create: `dashboard/web/src/components/SetupGate.tsx`
- Modify: `dashboard/web/src/App.tsx` (wrap the existing app render)
- Test: `dashboard/web/test/SetupGate.test.tsx`

**Interfaces:**

- Consumes: `GET /api/setup-state` (Task 3)
- Produces: `SetupGate({ children }: { children: ReactNode })` — polls
  `/api/setup-state` every 3s while not ready, renders a checklist (4 rows,
  each ✓/✗) instead of `children` until `ready` is true, then renders
  `children`.

- [ ] **Step 1: Write the failing test**

```typescript
// dashboard/web/test/SetupGate.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { SetupGate } from "../src/components/SetupGate";

describe("SetupGate", () => {
  it("renders the checklist, not children, while not ready", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        driveConnected: false, calendarConnected: true,
        mesaTokenPresent: true, claudeCliLoggedIn: true, ready: false,
      }),
    }) as any;
    render(<SetupGate><div>real app</div></SetupGate>);
    expect(await screen.findByText(/Drive/)).toBeInTheDocument();
    expect(screen.queryByText("real app")).not.toBeInTheDocument();
  });

  it("renders children once ready", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        driveConnected: true, calendarConnected: true,
        mesaTokenPresent: true, claudeCliLoggedIn: true, ready: true,
      }),
    }) as any;
    render(<SetupGate><div>real app</div></SetupGate>);
    expect(await screen.findByText("real app")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd dashboard/web && npx vitest run test/SetupGate.test.tsx`
Expected: FAIL — component doesn't exist

- [ ] **Step 3: Write `SetupGate.tsx`**

```tsx
import { useEffect, useState, type ReactNode } from "react";
import { Card } from "./ui/card";

interface SetupState {
  driveConnected: boolean;
  calendarConnected: boolean;
  mesaTokenPresent: boolean;
  claudeCliLoggedIn: boolean;
  ready: boolean;
}

const ROWS: { key: keyof Omit<SetupState, "ready">; label: string }[] = [
  { key: "driveConnected", label: "Google Drive access" },
  { key: "calendarConnected", label: "Google Calendar access" },
  { key: "mesaTokenPresent", label: "Mesa LMS refresh token" },
  { key: "claudeCliLoggedIn", label: "Claude Code CLI login" },
];

export function SetupGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SetupState | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = () => {
      fetch("/api/setup-state")
        .then((r) => r.json())
        .then((s: SetupState) => {
          if (cancelled) return;
          setState(s);
          if (!s.ready) timer = setTimeout(poll, 3000);
        })
        .catch(() => {
          if (!cancelled) timer = setTimeout(poll, 3000);
        });
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  if (state?.ready) return <>{children}</>;

  return (
    <div className="mx-auto max-w-[600px] px-4 py-12">
      <Card className="md:p-6">
        <h2 className="mb-4 font-bold">Finish setup to open the dashboard</h2>
        <ul className="space-y-2">
          {ROWS.map((r) => (
            <li key={r.key} className="flex items-center gap-2">
              <span>{state?.[r.key] ? "✓" : "✗"}</span>
              <span>{r.label}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd dashboard/web && npx vitest run test/SetupGate.test.tsx`
Expected: PASS (2/2)

- [ ] **Step 5: Wrap `App.tsx`'s render in `SetupGate`**

In `App.tsx`, wrap whatever the top-level return currently is:

```tsx
return <SetupGate>{/* existing App JSX unchanged */}</SetupGate>;
```

- [ ] **Step 6: Run the full web suite**

Run: `cd dashboard/web && npx vitest run`
Expected: all tests pass. Any `App.test.tsx`-level test that renders
`<App />` directly and expects immediate tab content will now need to mock
`fetch("/api/setup-state")` to resolve `ready: true` first — fix forward.

- [ ] **Step 7: Commit**

```bash
git add dashboard/web/src/components/SetupGate.tsx dashboard/web/src/App.tsx dashboard/web/test/SetupGate.test.tsx
git commit -m "feat: block the dashboard behind a setup checklist until onboarding is complete"
```
