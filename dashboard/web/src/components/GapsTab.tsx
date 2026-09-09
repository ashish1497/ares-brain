import { useState } from "react";
import type { TabProps } from "../lib/types";
import type { OverviewMissingBook } from "../api";
import { upload } from "../api";
import { SectionHeader } from "./SectionHeader";
import { MetaRow } from "./MetaRow";
import { Card } from "./ui/card";
import { Button } from "./ui/button";

type UploadResult = {
  written: string[];
  rejected: { name: string; reason: string }[];
  error?: string;
};

/** Renders an upload outcome the same way for every dropzone in this tab. */
function ResultLine({ result }: { result: UploadResult }) {
  return (
    <p className="mt-2 text-[13px]">
      {result.error ? (
        <span>upload failed: {result.error}</span>
      ) : (
        <>
          {result.written.length > 0 && <span>written: {result.written.join(", ")}</span>}
          {result.rejected.length > 0 && (
            <span>
              {" "}
              rejected: {result.rejected.map((r) => `${r.name} (${r.reason})`).join(", ")}
            </span>
          )}
        </>
      )}
    </p>
  );
}

function BookRow({
  book,
  courseName,
  result,
  onFiles,
}: {
  book: OverviewMissingBook;
  courseName: string;
  result: UploadResult | undefined;
  onFiles: (files: FileList) => void;
}) {
  const hasCourse = book.mentionedIn.length > 0;
  return (
    <div data-book-row={book.title} className="py-3">
      <div className="font-medium">
        {book.title} — {book.author}
      </div>
      <p className="mb-2 text-[13px] text-[color:var(--color-ink-muted)]">
        mentioned in {courseName}
      </p>
      {hasCourse ? (
        <label
          className="block cursor-pointer rounded-nb border-[3px] border-dashed border-edge p-2 text-[13px] focus-within:ring-2 focus-within:ring-edge"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0)
              onFiles(e.dataTransfer.files);
          }}
        >
          <span className="text-[color:var(--color-ink-muted)]">
            drop a PDF here, or put it in courses/{book.mentionedIn[0]}/inbox/books/
          </span>
          <input
            type="file"
            accept="application/pdf"
            multiple
            aria-label={`Upload PDF for ${book.title}`}
            className="sr-only"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) onFiles(e.target.files);
            }}
          />
        </label>
      ) : (
        <p className="text-[13px] text-[color:var(--color-ink-muted)]">
          no matching course — drop the PDF into the course&apos;s inbox/books/ folder manually
        </p>
      )}
      {result && <ResultLine result={result} />}
    </div>
  );
}

/** Gaps — pending transcripts, missing books, and a stale-scrape notice, each hidden when empty. */
export function GapsTab({ ov, onJob, busy }: TabProps) {
  const [results, setResults] = useState<Record<string, UploadResult>>({});
  const { pendingTranscripts, missingBooks, scrapeStale, attendanceStale } = ov.gaps;

  const courseNameBySlug = new Map(ov.brain.map((b) => [b.courseSlug, b.course]));
  const courseName = (slug: string) => courseNameBySlug.get(slug) ?? slug;

  const recCourses = [...ov.brain].sort((a, b) => a.course.localeCompare(b.course));
  const [recSlug, setRecSlug] = useState(() => recCourses[0]?.courseSlug ?? "");
  const [recResults, setRecResults] = useState<Record<string, UploadResult>>({});

  function handleRecordingUpload(slug: string, files: FileList) {
    upload(slug, "recording", files)
      .then((res) => {
        const result: UploadResult = Array.isArray(res.written)
          ? { written: res.written, rejected: res.rejected ?? [] }
          : { written: [], rejected: [], error: res.error ?? "unknown error" };
        setRecResults((rs) => ({ ...rs, [slug]: result }));
      })
      .catch((err) => {
        setRecResults((rs) => ({
          ...rs,
          [slug]: { written: [], rejected: [], error: String(err) },
        }));
      });
  }

  function handleUpload(book: OverviewMissingBook, files: FileList) {
    upload(book.mentionedIn[0], "book", files)
      .then((res) => {
        const result: UploadResult = Array.isArray(res.written)
          ? { written: res.written, rejected: res.rejected ?? [] }
          : { written: [], rejected: [], error: res.error ?? "unknown error" };
        setResults((rs) => ({ ...rs, [book.title]: result }));
      })
      .catch((err) => {
        setResults((rs) => ({
          ...rs,
          [book.title]: { written: [], rejected: [], error: String(err) },
        }));
      });
  }

  // Spec §4: cta (yellow) is the single primary action per view — a button set is only a
  // cta when there is exactly one of it (same rule the Exams tab already follows).
  const transcribeVariant = pendingTranscripts.length === 1 ? "default" : "neutral";
  const scrapeAgeDays = Math.round(ov.scrapeAgeHours / 24);

  const showStale = scrapeStale || attendanceStale;
  const allEmpty = pendingTranscripts.length === 0 && missingBooks.length === 0 && !showStale;

  return (
    <div className="space-y-6">
      <SectionHeader info="Everything the system is missing or waiting on.">Gaps</SectionHeader>

      {allEmpty && (
        <Card className="gap-0 md:p-6">
          <p className="text-[13px] text-[color:var(--color-ink-muted)]">Nothing outstanding.</p>
        </Card>
      )}

      {pendingTranscripts.length > 0 && (
        <Card className="gap-0 md:p-6">
          <SectionHeader rule={false}>Transcripts</SectionHeader>
          <div className="divide-y divide-[color:var(--color-rule)]">
            {pendingTranscripts.map((g) => (
              <div key={g.courseSlug} className="py-3">
                <div className="flex items-center justify-between gap-3">
                  <MetaRow items={[`${g.count} recordings`, g.course]} />
                  <Button
                    type="button"
                    variant={transcribeVariant}
                    size="sm"
                    disabled={busy}
                    onClick={() => onJob("transcribe", { course: g.courseSlug })}
                  >
                    Transcribe all
                  </Button>
                </div>
                <details className="mt-2">
                  <summary className="cursor-pointer text-[13px] text-[color:var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge">
                    {g.course} — sessions
                  </summary>
                  <ul className="mt-2 divide-y divide-[color:var(--color-rule)]">
                    {g.items.map((item, i) => (
                      <li key={i} className="py-2 text-[13px]">
                        {item.title}
                        {item.recordedOn && (
                          <span className="text-[color:var(--color-ink-muted)]">
                            {" "}
                            — {item.recordedOn}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
            ))}
          </div>
        </Card>
      )}

      {missingBooks.length > 0 && (
        <Card className="gap-0 md:p-6">
          <SectionHeader rule={false}>Missing books</SectionHeader>
          <div className="divide-y divide-[color:var(--color-rule)]">
            {missingBooks.map((book) => (
              <BookRow
                key={book.title}
                book={book}
                courseName={book.mentionedIn.map(courseName).join(", ")}
                result={results[book.title]}
                onFiles={(files) => handleUpload(book, files)}
              />
            ))}
          </div>
        </Card>
      )}

      {showStale && (
        <Card className="gap-0 md:p-6">
          <SectionHeader rule={false}>Stale</SectionHeader>
          {scrapeStale && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px]">
                scrape is {scrapeAgeDays} day{scrapeAgeDays === 1 ? "" : "s"} old
              </span>
              <Button
                type="button"
                variant="neutral"
                size="sm"
                disabled={busy}
                onClick={() => onJob("sync")}
              >
                Re-sync
              </Button>
            </div>
          )}
          {attendanceStale && (
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="text-[13px] text-[color:var(--color-ink-muted)]">
                attendance data is behind the calendar
              </p>
              <Button
                type="button"
                variant="neutral"
                size="sm"
                disabled={busy}
                onClick={() => onJob("calendar-sync")}
              >
                Sync calendar
              </Button>
            </div>
          )}
        </Card>
      )}

      <Card className="gap-0 md:p-6">
        <SectionHeader
          rule={false}
          info="Drop class audio or video you recorded yourself. Transcribe it locally into the course brain — no upload to YouTube, no network."
        >
          Your recordings
        </SectionHeader>
        <div className="flex flex-col gap-3">
          <select
            aria-label="Course for your recording"
            className="rounded-nb border-[3px] border-edge bg-card p-2 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge"
            value={recSlug}
            onChange={(e) => setRecSlug(e.target.value)}
          >
            {recCourses.map((c) => (
              <option key={c.courseSlug} value={c.courseSlug}>
                {c.course}
              </option>
            ))}
          </select>
          <label
            className="block cursor-pointer rounded-nb border-[3px] border-dashed border-edge p-2 text-[13px] focus-within:ring-2 focus-within:ring-edge"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (e.dataTransfer.files && e.dataTransfer.files.length > 0)
                handleRecordingUpload(recSlug, e.dataTransfer.files);
            }}
          >
            <span className="text-[color:var(--color-ink-muted)]">
              drop a recording here (.m4a .mp3 .wav .mp4 .webm)
            </span>
            <input
              type="file"
              accept=".m4a,.mp3,.wav,.mp4,.webm"
              multiple
              aria-label="Upload a recording"
              className="sr-only"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0)
                  handleRecordingUpload(recSlug, e.target.files);
              }}
            />
          </label>
          <p className="text-[13px] text-[color:var(--color-ink-muted)]">
            or put files in courses/{recSlug}/inbox/recordings/
          </p>
          {recResults[recSlug] && <ResultLine result={recResults[recSlug]} />}
          <div>
            <Button
              type="button"
              variant="neutral"
              size="sm"
              disabled={busy}
              onClick={() => onJob("transcribe-inbox", { course: recSlug })}
            >
              Transcribe dropped recordings
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
