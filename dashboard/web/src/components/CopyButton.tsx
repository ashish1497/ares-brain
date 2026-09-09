import { useState } from "react";
import { Button, type ButtonProps } from "./ui/button";

/**
 * The dashboard's action hand-off: copies a `/mesa:ares-brain-…` command to the
 * clipboard and shows a 2s "copied — paste in Claude Code" note. Defaults to the
 * yellow CTA styling; pass `variant`/`size` to demote it to a secondary action when
 * another `cta` already exists on the same view (e.g. the focused assignment page's
 * "Brief this session" button must not compete with "Start in Claude").
 * (The in-app chatbot that would run these is phase 2 — out of scope here.)
 */
export function CopyButton({
  value,
  label = "Copy",
  variant = "default",
  size = "sm",
}: {
  value: string;
  label?: string;
  variant?: "default" | "neutral";
  size?: ButtonProps["size"];
}) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        variant={variant}
        size={size}
        onClick={() => {
          navigator.clipboard
            ?.writeText(value)
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            })
            .catch(() => {});
        }}
      >
        {label}
      </Button>
      {copied && (
        <span className="text-xs font-bold text-[color:var(--color-ink-muted)]">
          copied — paste in Claude Code
        </span>
      )}
    </span>
  );
}
