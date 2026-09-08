import { useState } from "react";
import { Button } from "./ui/button";

/**
 * The dashboard's action hand-off: copies a `/mesa:ares-brain-…` command to the
 * clipboard and shows a 2s "copied — paste in Claude Code" note. Yellow CTA styling.
 * (The in-app chatbot that would run these is phase 2 — out of scope here.)
 */
export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        variant="default"
        size="sm"
        onClick={() => {
          navigator.clipboard?.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {label}
      </Button>
      {copied && (
        <span className="text-xs font-bold text-[var(--color-edge)]">
          copied — paste in Claude Code
        </span>
      )}
    </span>
  );
}
