import { Card } from "./Card";
import type { Job, State } from "../api";

export function SyncCard({
  job,
  last,
  busy,
  onRun,
}: {
  job: Job | null;
  last?: State["lastRuns"][string];
  busy: boolean;
  onRun: () => void;
}) {
  const running = busy && job?.kind === "sync";
  return (
    <Card icon="refresh" title="Sync from Nexus">
      <p class="mb-3 text-[13px] leading-relaxed text-[var(--color-ink-soft)]">
        Scrape, ingest, and re-index every course.
        {last
          ? ` Last run ${new Date(last.finishedAt).toLocaleString()}${last.exitCode ? " (failed)" : ""}.`
          : ""}
      </p>
      <button
        class="h-9 w-full rounded-md border border-[var(--color-line)] text-sm disabled:opacity-50"
        disabled={busy}
        onClick={onRun}
      >
        {running ? "Sync running…" : busy ? "Job running…" : "Run sync"}
      </button>
    </Card>
  );
}
