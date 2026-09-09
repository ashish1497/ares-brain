import { useState } from "react";
import { Button } from "../ui/button";
import { SectionHeader } from "../SectionHeader";

interface ChecklistItem {
  text: string;
  done: boolean;
}

const STATUSES = ["not started", "started", "submitted"] as const;

function readChecklist(id: string): ChecklistItem[] {
  try {
    const raw = localStorage.getItem(`ares.checklist.${id}`);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v)
      ? v.filter(
          (x): x is ChecklistItem => typeof x?.text === "string" && typeof x?.done === "boolean",
        )
      : [];
  } catch {
    return [];
  }
}

function writeChecklist(id: string, items: ChecklistItem[]): boolean {
  try {
    localStorage.setItem(`ares.checklist.${id}`, JSON.stringify(items));
    return true;
  } catch {
    // local-only convenience feature — a blocked/private-mode store must not crash the page.
    return false;
  }
}

function readStatus(id: string): string {
  try {
    const v = localStorage.getItem(`ares.localstatus.${id}`);
    return v != null && (STATUSES as readonly string[]).includes(v) ? v : STATUSES[0];
  } catch {
    return STATUSES[0];
  }
}

function writeStatus(id: string, status: string): void {
  try {
    localStorage.setItem(`ares.localstatus.${id}`, status);
  } catch {
    // same rationale as writeChecklist above.
  }
}

/**
 * Local-only step checklist + status tracker for one assignment, persisted to
 * `localStorage` — never sent to the LMS. Every mutation writes back immediately.
 */
export function AssignmentChecklist({ id }: { id: string }) {
  const [items, setItems] = useState<ChecklistItem[]>(() => readChecklist(id));
  const [text, setText] = useState("");
  const [status, setStatus] = useState<string>(() => readStatus(id));
  const [saveFailed, setSaveFailed] = useState(false);

  function commit(next: ChecklistItem[]) {
    setItems(next);
    setSaveFailed(!writeChecklist(id, next));
  }

  function add() {
    const t = text.trim();
    if (!t) return;
    commit([...items, { text: t, done: false }]);
    setText("");
  }

  return (
    <div>
      <SectionHeader rule={false}>Checklist</SectionHeader>
      {items.length > 0 && (
        <ul className="mb-3 divide-y divide-[color:var(--color-rule)]">
          {items.map((it, i) => (
            <li key={i} className="flex items-center gap-2 py-2">
              <input
                type="checkbox"
                checked={it.done}
                onChange={() =>
                  commit(items.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))
                }
                className="accent-[color:var(--color-edge)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge"
              />
              <span className={it.done ? "flex-1 line-through" : "flex-1"}>{it.text}</span>
              <button
                type="button"
                aria-label="delete"
                onClick={() => commit(items.filter((_, j) => j !== i))}
                className="px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") add();
        }}
        placeholder="Add a step"
        className="w-full rounded-nb border-[3px] border-edge bg-card px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge"
      />
      {saveFailed && (
        <p className="mt-2 text-[13px] text-[color:var(--color-ink-muted)]">
          not saved — storage unavailable
        </p>
      )}
      <div className="mt-4 flex gap-2">
        {STATUSES.map((s) => (
          <Button
            key={s}
            type="button"
            size="sm"
            variant={status === s ? "neutral" : "ghost"}
            aria-pressed={status === s}
            onClick={() => {
              setStatus(s);
              writeStatus(id, s);
            }}
          >
            {s}
          </Button>
        ))}
      </div>
      <p className="mt-2 text-[13px] text-[color:var(--color-ink-muted)]">
        local only — not sent to the LMS
      </p>
    </div>
  );
}
