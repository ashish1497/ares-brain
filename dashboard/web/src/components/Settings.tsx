import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import { getThemePrefs, setThemePrefs, type Appearance, type ThemeName } from "../lib/theme";
import type { Overview } from "../api";

const SWATCHES: { theme: ThemeName; label: string; colors: string[] }[] = [
  { theme: "meadow", label: "Meadow", colors: ["#0f8a5f", "#eafff4", "#ffffff", "#ffd23f"] },
  { theme: "violet", label: "Ultraviolet", colors: ["#5b21b6", "#faf3e0", "#fffdf7", "#ffd23f"] },
];

const APPEARANCES: { value: Appearance; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** Settings panel: theme swatches, appearance segmented control, read-only env values. */
export function Settings({
  open,
  onClose,
  ov,
}: {
  open: boolean;
  onClose: () => void;
  ov: Pick<Overview, "attendanceMin" | "chatUnlockAt">;
}) {
  const [prefs, setPrefs] = useState(getThemePrefs);

  useEffect(() => {
    if (open) setPrefs(getThemePrefs());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  function pick(theme: ThemeName) {
    const next = { ...prefs, theme };
    setPrefs(next);
    setThemePrefs(next);
  }
  function pickAppearance(appearance: Appearance) {
    const next = { ...prefs, appearance };
    setPrefs(next);
    setThemePrefs(next);
  }

  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-black/30" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Settings"
        className="h-full w-full max-w-sm overflow-y-auto rounded-nb border-[3px] border-edge bg-card p-4 shadow-[var(--nb-shadow)] md:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.08em]">Settings</h2>
          <Button type="button" variant="neutral" size="icon" onClick={onClose} aria-label="Close">
            ×
          </Button>
        </div>

        <div className="mb-6">
          <div className="mb-2 text-[11px] font-bold uppercase text-[color:var(--color-ink-muted)]">
            Theme
          </div>
          <div className="flex gap-3">
            {SWATCHES.map((s) => (
              <button
                key={s.theme}
                type="button"
                aria-pressed={prefs.theme === s.theme}
                onClick={() => pick(s.theme)}
                className={cn(
                  "flex flex-1 flex-col items-start gap-2 rounded-nb border-[3px] p-2 text-left text-[12px] font-bold",
                  prefs.theme === s.theme
                    ? "border-edge bg-paper translate-y-[2px]"
                    : "border-transparent hover:bg-paper",
                )}
              >
                <div className="flex gap-1">
                  {s.colors.map((c, i) => (
                    <span
                      key={i}
                      className="h-4 w-4 rounded-nb border-[3px] border-edge"
                      style={{ background: c }}
                    />
                  ))}
                </div>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-6">
          <div className="mb-2 text-[11px] font-bold uppercase text-[color:var(--color-ink-muted)]">
            Appearance
          </div>
          <div className="flex gap-1">
            {APPEARANCES.map((a) => (
              <button
                key={a.value}
                type="button"
                aria-pressed={prefs.appearance === a.value}
                onClick={() => pickAppearance(a.value)}
                className={cn(
                  "flex-1 rounded-nb border-[3px] px-2 py-1 text-[12px] font-bold",
                  prefs.appearance === a.value
                    ? "border-edge bg-paper translate-y-[2px]"
                    : "border-transparent hover:bg-paper",
                )}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 text-[11px] font-bold uppercase text-[color:var(--color-ink-muted)]">
            Environment
          </div>
          <ul className="flex flex-col gap-1 text-[12px] text-[color:var(--color-ink-muted)]">
            <li>attendance minimum {ov.attendanceMin}% (set via ARES_BRAIN_ATTENDANCE_MIN)</li>
            <li>chat unlock {ov.chatUnlockAt} (set via ARES_BRAIN_CHAT_UNLOCK)</li>
            <li>port 4319</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
