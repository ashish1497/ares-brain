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
