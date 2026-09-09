import type { OverviewChanged } from "../../api";
import { fmtScrapeAge } from "../../lib/format";
import { SectionHeader } from "../SectionHeader";
import { StatePill } from "../StatePill";
import { Card } from "../ui/card";

/** `"4 announcements"` / `"1 material"` — pluralises a change-kind count. */
export function pluralizeCount(kind: string, n: number): string {
  return `${n} ${kind}${n === 1 ? "" : "s"}`;
}

/** What changed on each course since the last scrape, as course-name rows of count chips. */
export function ChangedFeed({
  changed,
  scrapeAgeHours,
}: {
  changed: OverviewChanged[];
  scrapeAgeHours: number;
}) {
  if (changed.length === 0) return null;
  return (
    <Card className="gap-0 md:p-6">
      <SectionHeader info="What changed on the LMS since the last sync.">
        Since last scrape
      </SectionHeader>
      <p className="mb-3 text-[13px] text-[color:var(--color-ink-muted)]">
        updated {fmtScrapeAge(scrapeAgeHours)}
      </p>
      <div className="divide-y divide-[color:var(--color-rule)]">
        {changed.map((c, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 py-3">
            <span className="font-medium">{c.courseName}</span>
            {Object.entries(c.counts).map(([kind, n]) => (
              <StatePill key={kind} state="neutral">
                {pluralizeCount(kind, n)}
              </StatePill>
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}
