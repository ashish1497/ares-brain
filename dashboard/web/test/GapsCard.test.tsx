import { render, screen, fireEvent } from "@testing-library/react";
import { GapsCard } from "../src/components/GapsCard";
import { gaps } from "./factories";

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
      onJob={onJob}
      gaps={gaps({ pendingTranscripts: [group("art-of-selling", 6), group("power-of-comm", 2)] })}
    />,
  );
  const buttons = screen.getAllByRole("button", { name: "Transcribe all" });
  expect(buttons).toHaveLength(2);
  fireEvent.click(buttons[0]);
  expect(onJob).toHaveBeenCalledWith("transcribe", { course: "art-of-selling" });
});

test("scrapeStale renders a Sync row; false hides it", () => {
  const onJob = vi.fn();
  const { rerender } = render(
    <GapsCard busy={false} onJob={onJob} gaps={gaps({ scrapeStale: true })} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Sync" }));
  expect(onJob).toHaveBeenCalledWith("sync");

  rerender(<GapsCard busy={false} onJob={onJob} gaps={gaps({ scrapeStale: false })} />);
  expect(screen.queryByRole("button", { name: "Sync" })).not.toBeInTheDocument();
});

test("empty state when there are no gaps", () => {
  render(<GapsCard busy={false} onJob={vi.fn()} gaps={gaps()} />);
  expect(screen.getByText("Nothing outstanding")).toBeInTheDocument();
});
