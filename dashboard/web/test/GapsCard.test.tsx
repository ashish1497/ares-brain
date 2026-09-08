import { render, screen, fireEvent } from "@testing-library/react";
import * as api from "../src/api";
import { GapsCard } from "../src/components/GapsCard";
import { gaps } from "./factories";

vi.mock("../src/api", async (orig) => ({
  ...(await orig<typeof import("../src/api")>()),
  upload: vi.fn(),
}));

const group = (slug: string, count: number) => ({
  course: slug,
  courseSlug: slug,
  count,
  items: [],
});

test("renders a Transcribe button per pending-transcript group; click calls onJob", () => {
  const onJob = vi.fn();
  render(
    <GapsCard
      busy={false}
      ageHours={2}
      onJob={onJob}
      gaps={gaps({ pendingTranscripts: [group("art-of-selling", 6), group("power-of-comm", 2)] })}
    />,
  );
  const buttons = screen.getAllByRole("button", { name: "Transcribe all" });
  expect(buttons).toHaveLength(2);
  fireEvent.click(buttons[0]);
  expect(onJob).toHaveBeenCalledWith("transcribe", { course: "art-of-selling" });
});

test("scrapeStale renders a Sync row with the scrape age; false hides it", () => {
  const onJob = vi.fn();
  const { rerender } = render(
    <GapsCard busy={false} ageHours={72} onJob={onJob} gaps={gaps({ scrapeStale: true })} />,
  );
  expect(screen.getByText("Scrape is 3 days old")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Sync" }));
  expect(onJob).toHaveBeenCalledWith("sync");

  rerender(
    <GapsCard busy={false} ageHours={72} onJob={onJob} gaps={gaps({ scrapeStale: false })} />,
  );
  expect(screen.queryByRole("button", { name: "Sync" })).not.toBeInTheDocument();
});

test("scrape age under a day renders in hours", () => {
  render(<GapsCard busy={false} ageHours={5} onJob={vi.fn()} gaps={gaps({ scrapeStale: true })} />);
  expect(screen.getByText("Scrape is 5h old")).toBeInTheDocument();
});

test("selecting a PDF for a missing book calls upload and renders the result", async () => {
  vi.mocked(api.upload).mockResolvedValue({ written: ["resonate.pdf"], rejected: [] });
  render(
    <GapsCard
      busy={false}
      ageHours={2}
      onJob={vi.fn()}
      gaps={gaps({
        missingBooks: [
          { title: "Resonate", author: "Nancy Duarte", mentionedIn: ["power-of-comm"] },
        ],
      })}
    />,
  );
  const input = screen.getByLabelText("Upload PDF for Resonate");
  const file = new File(["%PDF"], "resonate.pdf", { type: "application/pdf" });
  fireEvent.change(input, { target: { files: [file] } });

  expect(api.upload).toHaveBeenCalledWith("power-of-comm", "book", expect.anything());
  expect((vi.mocked(api.upload).mock.calls[0][2] as ArrayLike<File>)[0].name).toBe("resonate.pdf");
  expect(await screen.findByText("added resonate.pdf")).toBeInTheDocument();
});

test("a rejected upload renders the reason", async () => {
  vi.mocked(api.upload).mockResolvedValue({
    written: [],
    rejected: [{ name: "notes.txt", reason: "not a pdf" }],
  });
  render(
    <GapsCard
      busy={false}
      ageHours={2}
      onJob={vi.fn()}
      gaps={gaps({
        missingBooks: [
          { title: "Resonate", author: "Nancy Duarte", mentionedIn: ["power-of-comm"] },
        ],
      })}
    />,
  );
  fireEvent.change(screen.getByLabelText("Upload PDF for Resonate"), {
    target: { files: [new File(["x"], "notes.txt")] },
  });
  expect(await screen.findByText("rejected: notes.txt — not a pdf")).toBeInTheDocument();
});

test("empty state when there are no gaps", () => {
  render(<GapsCard busy={false} ageHours={2} onJob={vi.fn()} gaps={gaps()} />);
  expect(screen.getByText("Nothing outstanding")).toBeInTheDocument();
});
