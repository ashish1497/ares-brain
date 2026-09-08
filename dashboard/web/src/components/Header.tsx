import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import type { Overview } from "../api";

/** `ARES BRAIN` chip, date + term, "scrape Xh ago", and a Sync button when the scrape is stale. */
export function Header({
  ov,
  busy,
  onJob,
}: {
  ov: Overview;
  busy: boolean;
  onJob: (kind: string, opts?: Record<string, string>) => void;
}) {
  const hrs = Math.round(ov.scrapeAgeHours);
  return (
    <header className="mb-4 flex flex-wrap items-center gap-3">
      <Badge variant="accent">ARES BRAIN</Badge>
      <span className="text-sm font-bold">{ov.date}</span>
      <span className="text-sm opacity-70">· {ov.term}</span>
      <span className="text-sm opacity-70">· scrape {hrs}h ago</span>
      {ov.gaps.scrapeStale && (
        <Button
          type="button"
          variant="default"
          size="sm"
          disabled={busy}
          onClick={() => onJob("sync")}
        >
          Sync
        </Button>
      )}
    </header>
  );
}
