import { cn } from "../lib/utils";

const TAB_DEFS: { id: string; label: string; countKey?: "assignments" | "gaps" }[] = [
  { id: "today", label: "Today" },
  { id: "assignments", label: "Assignments", countKey: "assignments" },
  { id: "attendance", label: "Attendance" },
  { id: "exams", label: "Exams" },
  { id: "brain", label: "Brain" },
  { id: "gaps", label: "Gaps", countKey: "gaps" },
];

/** Sticky tab bar beneath the summary bar; active tab reads "pressed", inactive is flat. */
export function Tabs({
  active,
  counts,
  onSelect,
}: {
  active: string;
  counts: { assignments: number; gaps: number };
  onSelect: (tab: string) => void;
}) {
  return (
    <nav className="sticky top-14 z-10 border-b border-rule bg-paper">
      <div className="mx-auto flex h-11 max-w-[1400px] gap-1 overflow-x-auto px-4 md:px-8">
        {TAB_DEFS.map((t) => {
          const isActive = active === t.id;
          const count = t.countKey ? counts[t.countKey] : 0;
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={isActive}
              onClick={() => onSelect(t.id)}
              className={cn(
                "flex items-center gap-1 whitespace-nowrap rounded-nb border-[3px] px-4 text-[13px] font-bold",
                isActive
                  ? "translate-y-[2px] border-edge bg-card"
                  : "border-transparent hover:bg-card/60",
              )}
            >
              {t.label}
              {count > 0 && (
                <span className="rounded-nb border-[3px] border-edge bg-card px-1 text-[11px] text-[color:var(--color-ink)]">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
