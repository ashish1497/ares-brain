import { Section } from "./Section";
import { CopyButton } from "./CopyButton";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import type { OverviewBrain } from "../api";

const badgeVariant = (s: OverviewBrain["state"]) =>
  s === "ready" ? "ok" : s === "stale" ? "soon" : "bad";

/**
 * Where each course brain stands: state badge + `reason`. The deterministic fix
 * (`ingest` — transcribe + normalize) runs as a job; the LLM guide rebuild is a
 * copy-command hand-off.
 */
export function BrainCard({
  rows,
  busy,
  onJob,
}: {
  rows: OverviewBrain[];
  busy: boolean;
  onJob: (kind: string, opts?: Record<string, string>) => void;
}) {
  return (
    <Section title="Where you stand">
      <ul className="flex flex-col gap-2 text-sm">
        {rows.map((r) => (
          <li
            key={r.courseSlug}
            data-testid="brain-row"
            className="flex flex-wrap items-center gap-2"
          >
            <span className="font-bold">{r.course}</span>
            <Badge variant={badgeVariant(r.state)}>{r.state}</Badge>
            <span className="opacity-70">{r.reason}</span>
            {r.state !== "ready" && (
              <Button
                type="button"
                variant="neutral"
                size="sm"
                disabled={busy}
                onClick={() => onJob("ingest", { course: r.courseSlug })}
              >
                Ingest
              </Button>
            )}
            <CopyButton value={r.buildCommand} label="Build brain" />
          </li>
        ))}
      </ul>
    </Section>
  );
}
