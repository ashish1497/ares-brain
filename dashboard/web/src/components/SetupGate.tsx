import { useEffect, useState, type ReactNode } from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";

export interface SetupState {
  driveConnected: boolean;
  calendarConnected: boolean;
  mesaTokenPresent: boolean;
  claudeCliLoggedIn: boolean;
  ready: boolean;
}

interface SetupRow {
  key: keyof Omit<SetupState, "ready">;
  label: string;
  fix: string;
}

export const SETUP_ROWS: SetupRow[] = [
  {
    key: "driveConnected",
    label: "Google Drive access",
    fix: "cd scraper && uv run python lms_scrape.py calendar-auth  (one consent grants Drive + Calendar together)",
  },
  {
    key: "calendarConnected",
    label: "Google Calendar access",
    fix: "cd scraper && uv run python lms_scrape.py calendar-auth",
  },
  {
    key: "mesaTokenPresent",
    label: "Mesa LMS refresh token",
    fix: "Paste a fresh MESA_REFRESH_TOKEN into .env at the repo root.",
  },
  {
    key: "claudeCliLoggedIn",
    label: "Claude Code CLI login",
    fix: "claude setup-token  (run in Terminal). Already logged in? This check can be transient under load — try Retry first.",
  },
];

/** Shared checklist UI: what's pending and the exact command/step to fix it.
 * Used both by the blocking SetupGate (before the dashboard ever opens) and
 * by App's overview-load error path (if setup flips back to incomplete
 * after the gate already let the dashboard through — e.g. a transient
 * probe failure or a token expiring mid-session). */
export function SetupChecklist({
  state,
  onRetry,
}: {
  state: SetupState | null;
  onRetry?: () => void;
}) {
  return (
    <div className="mx-auto max-w-[600px] px-4 py-12">
      <Card className="md:p-6">
        <h2 className="mb-1 font-bold">Setup isn't complete yet</h2>
        <p className="mb-4 text-[13px] text-[color:var(--color-ink-muted)]">
          The dashboard needs all four of these before it can open.
        </p>
        <ul className="space-y-3">
          {SETUP_ROWS.map((r) => {
            const ok = state?.[r.key];
            return (
              <li key={r.key}>
                <div className="flex items-center gap-2">
                  <span
                    className={
                      ok ? "text-[color:var(--color-ok)]" : "text-[color:var(--color-bad)]"
                    }
                  >
                    {ok ? "✓" : "✗"}
                  </span>
                  <span className="font-medium">{r.label}</span>
                </div>
                {!ok && (
                  <code className="mt-1 ml-6 block rounded-nb border-[3px] border-edge bg-paper px-2 py-1 text-[12px]">
                    {r.fix}
                  </code>
                )}
              </li>
            );
          })}
        </ul>
        {onRetry && (
          <Button type="button" variant="neutral" size="sm" className="mt-4" onClick={onRetry}>
            Retry
          </Button>
        )}
      </Card>
    </div>
  );
}

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

  return <SetupChecklist state={state} />;
}
