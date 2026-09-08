import { render, screen, fireEvent } from "@testing-library/react";
import { BrainCard } from "../src/components/BrainCard";
import { brain } from "./factories";

test("shows a state badge and reason per course", () => {
  render(
    <BrainCard
      busy={false}
      onJob={vi.fn()}
      rows={[
        brain({ course: "Ready One", state: "ready", reason: "up to date" }),
        brain({ course: "Stale One", courseSlug: "stale-one", state: "stale", reason: "3 behind" }),
      ]}
    />,
  );
  expect(screen.getByText("ready")).toBeInTheDocument();
  expect(screen.getByText("3 behind")).toBeInTheDocument();
});

test("the Ingest job button is shown for non-ready courses and calls onJob", () => {
  const onJob = vi.fn();
  render(
    <BrainCard
      busy={false}
      onJob={onJob}
      rows={[brain({ courseSlug: "not-built", state: "not-built", pendingTranscripts: 4 })]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Ingest" }));
  expect(onJob).toHaveBeenCalledWith("ingest", { course: "not-built" });
});

test("no Ingest button for a ready course; buttons disabled while busy", () => {
  const { rerender } = render(<BrainCard busy={false} onJob={vi.fn()} rows={[brain()]} />);
  expect(screen.queryByRole("button", { name: "Ingest" })).not.toBeInTheDocument();

  rerender(<BrainCard busy onJob={vi.fn()} rows={[brain({ state: "stale" })]} />);
  expect(screen.getByRole("button", { name: "Ingest" })).toBeDisabled();
});
