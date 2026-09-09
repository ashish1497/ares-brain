import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as api from "../src/api";
import { GapsTab } from "../src/components/GapsTab";
import { brain, gaps, missingBook, overview, pendingTranscriptGroup } from "./factories";
import type { TabProps } from "../src/lib/types";

vi.mock("../src/api", async (orig) => ({
  ...(await orig<typeof import("../src/api")>()),
  upload: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(api.upload).mockResolvedValue({ written: [], rejected: [] });
});

const baseProps = (over: Partial<TabProps["ov"]> = {}, onJob = vi.fn()): TabProps => ({
  ov: overview(over),
  onJob,
  busy: false,
  go: () => {},
  params: [],
});

test("one Transcribe button per group", () => {
  render(
    <GapsTab
      {...baseProps({
        gaps: gaps({
          pendingTranscripts: [
            pendingTranscriptGroup({ course: "Course A", courseSlug: "a" }),
            pendingTranscriptGroup({ course: "Course B", courseSlug: "b" }),
          ],
        }),
      })}
    />,
  );
  expect(screen.getAllByRole("button", { name: /Transcribe all/ })).toHaveLength(2);
});

test("clicking Transcribe calls onJob('transcribe', {course})", () => {
  const onJob = vi.fn();
  render(
    <GapsTab
      {...baseProps(
        {
          gaps: gaps({
            pendingTranscripts: [pendingTranscriptGroup({ course: "Course A", courseSlug: "a" })],
          }),
        },
        onJob,
      )}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Transcribe all/ }));
  expect(onJob).toHaveBeenCalledWith("transcribe", { course: "a" });
});

test("scrapeStale: false hides the stale section", () => {
  render(
    <GapsTab
      {...baseProps({
        gaps: gaps({
          pendingTranscripts: [pendingTranscriptGroup()],
          scrapeStale: false,
        }),
      })}
    />,
  );
  expect(screen.queryByText(/days old/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Re-sync/ })).not.toBeInTheDocument();
});

test("stale section shows when scrapeStale: true", () => {
  render(
    <GapsTab
      {...baseProps({
        scrapeAgeHours: 72,
        gaps: gaps({ scrapeStale: true }),
      })}
    />,
  );
  expect(screen.getByText(/scrape is 3 days old/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Re-sync/ })).toBeInTheDocument();
});

test("attendanceStale renders a muted note", () => {
  render(
    <GapsTab
      {...baseProps({
        gaps: gaps({ scrapeStale: true, attendanceStale: true }),
      })}
    />,
  );
  expect(screen.getByText(/attendance data is behind the calendar/)).toBeInTheDocument();
});

test("upload input calls upload(mentionedIn[0], 'book', files)", async () => {
  render(
    <GapsTab
      {...baseProps({
        brain: [brain({ course: "Course A", courseSlug: "a" })],
        gaps: gaps({
          missingBooks: [missingBook({ title: "Book One", mentionedIn: ["a"] })],
        }),
      })}
    />,
  );
  const input = screen.getByLabelText(/Book One/i) as HTMLInputElement;
  const file = new File(["content"], "book.pdf", { type: "application/pdf" });
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => {
    expect(api.upload).toHaveBeenCalledWith("a", "book", expect.anything());
  });
});

test("mentionedIn renders course names, not slugs", () => {
  render(
    <GapsTab
      {...baseProps({
        brain: [brain({ course: "Business Frameworks", courseSlug: "business-frameworks" })],
        gaps: gaps({
          missingBooks: [missingBook({ title: "Book One", mentionedIn: ["business-frameworks"] })],
        }),
      })}
    />,
  );
  expect(screen.getByText(/mentioned in Business Frameworks/)).toBeInTheDocument();
  expect(screen.queryByText(/mentioned in business-frameworks/)).not.toBeInTheDocument();
});

test("mentionedIn falls back to the raw slug when the lookup misses", () => {
  render(
    <GapsTab
      {...baseProps({
        brain: [],
        gaps: gaps({
          missingBooks: [missingBook({ title: "Book One", mentionedIn: ["unknown-slug"] })],
        }),
      })}
    />,
  );
  expect(screen.getByText(/mentioned in unknown-slug/)).toBeInTheDocument();
});

test("all three sections empty renders 'Nothing outstanding.'", () => {
  render(<GapsTab {...baseProps({ gaps: gaps() })} />);
  expect(screen.getByText("Nothing outstanding.")).toBeInTheDocument();
});

test("a failed upload (server returns { error }) renders the failure message instead of crashing", async () => {
  vi.mocked(api.upload).mockResolvedValue({
    written: undefined as unknown as string[],
    rejected: undefined as unknown as { name: string; reason: string }[],
    error: "unknown course",
  });
  render(
    <GapsTab
      {...baseProps({
        brain: [brain({ course: "Course A", courseSlug: "a" })],
        gaps: gaps({
          missingBooks: [missingBook({ title: "Book One", mentionedIn: ["a"] })],
        }),
      })}
    />,
  );
  const input = screen.getByLabelText(/Book One/i) as HTMLInputElement;
  const file = new File(["content"], "book.pdf", { type: "application/pdf" });
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => {
    expect(screen.getByText(/upload failed: unknown course/)).toBeInTheDocument();
  });
});

test("a rejected upload promise (network failure) is caught and rendered as a failure message", async () => {
  vi.mocked(api.upload).mockRejectedValue(new Error("network down"));
  render(
    <GapsTab
      {...baseProps({
        brain: [brain({ course: "Course A", courseSlug: "a" })],
        gaps: gaps({
          missingBooks: [missingBook({ title: "Book One", mentionedIn: ["a"] })],
        }),
      })}
    />,
  );
  const input = screen.getByLabelText(/Book One/i) as HTMLInputElement;
  const file = new File(["content"], "book.pdf", { type: "application/pdf" });
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => {
    expect(screen.getByText(/upload failed: Error: network down/)).toBeInTheDocument();
  });
});

test("mentionedIn: [] hides the upload input and shows the manual-inbox fallback", () => {
  render(
    <GapsTab
      {...baseProps({
        gaps: gaps({
          missingBooks: [missingBook({ title: "Book One", mentionedIn: [] })],
        }),
      })}
    />,
  );
  expect(screen.queryByLabelText(/Book One/i)).not.toBeInTheDocument();
  expect(screen.getByText(/no matching course/)).toBeInTheDocument();
});

test("dropping a file on the drop zone calls upload, same as the file input", async () => {
  render(
    <GapsTab
      {...baseProps({
        brain: [brain({ course: "Course A", courseSlug: "a" })],
        gaps: gaps({
          missingBooks: [missingBook({ title: "Book One", mentionedIn: ["a"] })],
        }),
      })}
    />,
  );
  const dropZone = document.querySelector('[data-book-row="Book One"] label')!;
  const file = new File(["content"], "dropped.pdf", { type: "application/pdf" });
  const dataTransfer = { files: [file] };
  fireEvent.drop(dropZone, { dataTransfer });
  await waitFor(() => {
    expect(api.upload).toHaveBeenCalledWith("a", "book", expect.anything());
  });
});

test("busy disables the Transcribe all button", () => {
  render(
    <GapsTab
      {...baseProps(
        {
          gaps: gaps({
            pendingTranscripts: [pendingTranscriptGroup({ course: "Course A", courseSlug: "a" })],
          }),
        },
        vi.fn(),
      )}
      busy={true}
    />,
  );
  expect(screen.getByRole("button", { name: /Transcribe all/ })).toBeDisabled();
});

test("book upload messages keyed by title survive a re-render with a reordered list", async () => {
  vi.mocked(api.upload).mockResolvedValue({ written: ["book-one.pdf"], rejected: [] });
  const props = baseProps({
    brain: [brain({ course: "Course A", courseSlug: "a" })],
    gaps: gaps({
      missingBooks: [
        missingBook({ title: "Book One", mentionedIn: ["a"] }),
        missingBook({ title: "Book Two", mentionedIn: ["a"] }),
      ],
    }),
  });
  const { rerender } = render(<GapsTab {...props} />);

  const inputOne = screen.getByLabelText(/Book One/i) as HTMLInputElement;
  const file = new File(["content"], "book-one.pdf", { type: "application/pdf" });
  fireEvent.change(inputOne, { target: { files: [file] } });
  await waitFor(() => {
    expect(screen.getByText(/written: book-one\.pdf/i)).toBeInTheDocument();
  });

  // Confirm the message is scoped to Book One's row, not Book Two's.
  const bookOneRow = document.querySelector('[data-book-row="Book One"]');
  expect(bookOneRow?.textContent).toContain("written: book-one.pdf");
  const bookTwoRow = document.querySelector('[data-book-row="Book Two"]');
  expect(bookTwoRow?.textContent).not.toContain("written: book-one.pdf");

  // Reorder the array (same title strings, new positions) and re-render.
  const reordered = baseProps({
    brain: [brain({ course: "Course A", courseSlug: "a" })],
    gaps: gaps({
      missingBooks: [
        missingBook({ title: "Book Two", mentionedIn: ["a"] }),
        missingBook({ title: "Book One", mentionedIn: ["a"] }),
      ],
    }),
  });
  rerender(<GapsTab {...reordered} />);

  const bookOneRowAfter = document.querySelector('[data-book-row="Book One"]');
  expect(bookOneRowAfter?.textContent).toContain("written: book-one.pdf");
  const bookTwoRowAfter = document.querySelector('[data-book-row="Book Two"]');
  expect(bookTwoRowAfter?.textContent).not.toContain("written: book-one.pdf");
});
