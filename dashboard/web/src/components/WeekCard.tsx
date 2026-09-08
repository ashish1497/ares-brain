import { Section } from "./Section";
import { CopyButton } from "./CopyButton";
import { Badge } from "./ui/badge";
import type { OverviewWeekItem } from "../api";

/** The next 7 days, sorted by `when`: date · title · course · status badge · copy-action. */
export function WeekCard({ week }: { week: OverviewWeekItem[] }) {
  const rows = [...week].sort((a, b) => a.when.localeCompare(b.when));
  return (
    <Section title="This week">
      {rows.length === 0 ? (
        <div className="text-sm opacity-70">Nothing in the next 7 days</div>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {rows.map((w, i) => (
            <li key={i} data-testid="week-row" className="flex flex-wrap items-center gap-2">
              <span className="font-bold">{w.when}</span>
              <span>· {w.title}</span>
              <span className="opacity-70">· {w.course}</span>
              {w.weightPct != null && <Badge variant="accent">{w.weightPct}%</Badge>}
              {w.status && <Badge>{w.status}</Badge>}
              {w.coverage && <Badge>{w.coverage}</Badge>}
              {w.action?.type === "copy" && (
                <CopyButton value={w.action.value} label={w.action.label} />
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
