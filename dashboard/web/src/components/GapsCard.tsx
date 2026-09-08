import { useState } from "react";
import { Section } from "./Section";
import { Button } from "./ui/button";
import { upload, type OverviewGaps, type OverviewMissingBook } from "../api";

type UploadState =
  | { pending: true }
  | { written: string[]; rejected: { name: string; reason: string }[] }
  | { error: string };

/**
 * "Needs your input": pending-transcript groups (Transcribe all → `transcribe --course`,
 * which pulls the YouTube links directly), missing books (with a small PDF dropzone that
 * reuses the `upload` api, course = first `mentionedIn`), stale scrape (Sync), and a
 * muted note when the attendance snapshot is behind the events feed.
 */
export function GapsCard({
  gaps,
  ageHours,
  busy,
  onJob,
}: {
  gaps: OverviewGaps;
  ageHours: number;
  busy: boolean;
  onJob: (kind: string, opts?: Record<string, string>) => void;
}) {
  const { pendingTranscripts, missingBooks, scrapeStale, attendanceStale } = gaps;
  const [uploads, setUploads] = useState<Record<number, UploadState>>({});
  const empty =
    pendingTranscripts.length === 0 &&
    missingBooks.length === 0 &&
    !scrapeStale &&
    !attendanceStale;

  const scrapeAgeLabel =
    ageHours < 24 ? `${Math.round(ageHours)}h old` : `${Math.round(ageHours / 24)} days old`;

  async function onFiles(i: number, book: OverviewMissingBook, files: FileList | null) {
    const course = book.mentionedIn[0];
    if (!course || !files || files.length === 0) return;
    setUploads((u) => ({ ...u, [i]: { pending: true } }));
    try {
      const r = await upload(course, "book", files);
      setUploads((u) => ({ ...u, [i]: r }));
    } catch (e) {
      setUploads((u) => ({ ...u, [i]: { error: e instanceof Error ? e.message : String(e) } }));
    }
  }

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
              <ul className="flex flex-col gap-2">
                {missingBooks.map((b, i) => {
                  const course = b.mentionedIn[0];
                  const u = uploads[i];
                  return (
                    <li key={i}>
                      {b.title} — {b.author}
                      {b.mentionedIn.length > 0 && (
                        <span className="opacity-70">
                          {" "}
                          · mentioned in {b.mentionedIn.join(", ")}
                        </span>
                      )}
                      {course && (
                        <div className="mt-1 flex flex-col gap-1">
                          <input
                            type="file"
                            accept="application/pdf"
                            multiple
                            aria-label={`Upload PDF for ${b.title}`}
                            className="rounded-nb border-[3px] border-dashed border-edge p-2 text-[11px]"
                            onChange={(e) => onFiles(i, b, e.target.files)}
                          />
                          <div className="opacity-70">
                            drop the PDF in inbox/{course}/books/ or use the upload
                          </div>
                          {u && "pending" in u && <div className="opacity-70">uploading…</div>}
                          {u && "written" in u && (
                            <div>
                              {u.written.map((n) => (
                                <div key={n}>added {n}</div>
                              ))}
                              {u.rejected.map((rj) => (
                                <div key={rj.name} className="text-[var(--color-bad)]">
                                  rejected: {rj.name} — {rj.reason}
                                </div>
                              ))}
                            </div>
                          )}
                          {u && "error" in u && (
                            <div className="text-[var(--color-bad)]">upload failed: {u.error}</div>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {scrapeStale && (
            <div data-testid="scrape-stale" className="flex flex-wrap items-center gap-2">
              <span>Scrape is {scrapeAgeLabel}</span>
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
