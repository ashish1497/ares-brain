import { Section } from "./Section";
import { Button } from "./ui/button";
import type { OverviewGaps } from "../api";

/**
 * "Needs your input": pending-transcript groups (Transcribe all → `transcribe --course`,
 * which pulls the YouTube links directly), missing books, stale scrape (Sync), and a
 * muted note when the attendance snapshot is behind the events feed.
 */
export function GapsCard({
  gaps,
  busy,
  onJob,
}: {
  gaps: OverviewGaps;
  busy: boolean;
  onJob: (kind: string, opts?: Record<string, string>) => void;
}) {
  const { pendingTranscripts, missingBooks, scrapeStale, attendanceStale } = gaps;
  const empty =
    pendingTranscripts.length === 0 &&
    missingBooks.length === 0 &&
    !scrapeStale &&
    !attendanceStale;
  return (
    <Section title="Needs your input">
      {empty ? (
        <div className="text-sm opacity-70">Nothing outstanding</div>
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          {pendingTranscripts.map((g) => (
            <div
              key={g.courseSlug}
              data-testid="transcribe-group"
              className="flex flex-wrap items-center gap-2"
            >
              <span>
                Transcribe {g.count} {g.course} session{g.count === 1 ? "" : "s"}
              </span>
              <Button
                type="button"
                variant="neutral"
                size="sm"
                disabled={busy}
                onClick={() => onJob("transcribe", { course: g.courseSlug })}
              >
                Transcribe all
              </Button>
            </div>
          ))}
          {missingBooks.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] font-bold uppercase opacity-70">Missing books</div>
              <ul className="flex flex-col gap-1">
                {missingBooks.map((b, i) => (
                  <li key={i}>
                    {b.title} — {b.author}
                    {b.mentionedIn.length > 0 && (
                      <span className="opacity-70"> · mentioned in {b.mentionedIn.join(", ")}</span>
                    )}
                    {b.mentionedIn[0] && (
                      <div className="opacity-70">
                        drop the PDF in inbox/{b.mentionedIn[0]}/books/ or use the upload
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {scrapeStale && (
            <div data-testid="scrape-stale" className="flex flex-wrap items-center gap-2">
              <span>Scrape is stale</span>
              <Button
                type="button"
                variant="neutral"
                size="sm"
                disabled={busy}
                onClick={() => onJob("sync")}
              >
                Sync
              </Button>
            </div>
          )}
          {attendanceStale && (
            <div data-testid="attendance-stale" className="opacity-70">
              Attendance data is behind the latest events — re-sync to refresh.
            </div>
          )}
        </div>
      )}
    </Section>
  );
}
