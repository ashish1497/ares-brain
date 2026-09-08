import { render, screen, fireEvent } from "@testing-library/react";
import { Header } from "../src/components/Header";
import type { Overview } from "../src/api";
import { gaps, kpis } from "./factories";

const ov = (over: Partial<Overview> = {}): Overview =>
  ({
    generatedAt: "",
    date: "2026-09-08",
    scrapeAgeHours: 2.4,
    term: "Term 1",
    kpis: kpis(),
    today: { classes: [], dueTodayOrTomorrow: [], changed: {} },
    thisWeek: [],
    assignments: [],
    gradePicture: [],
    exams: [],
    attendance: [],
    attendanceMin: 75,
    brain: [],
    chatUnlockAt: 15,
    gaps: gaps(),
    ...over,
  }) as Overview;

test("shows the date, term and scrape age", () => {
  render(<Header ov={ov()} busy={false} onJob={vi.fn()} />);
  expect(screen.getByText("2026-09-08")).toBeInTheDocument();
  expect(screen.getByText("· scrape 2h ago")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Sync" })).not.toBeInTheDocument();
});

test("shows a Sync button when the scrape is stale and calls onJob", () => {
  const onJob = vi.fn();
  render(<Header ov={ov({ gaps: gaps({ scrapeStale: true }) })} busy={false} onJob={onJob} />);
  fireEvent.click(screen.getByRole("button", { name: "Sync" }));
  expect(onJob).toHaveBeenCalledWith("sync");
});

test("Sync is disabled while a job runs", () => {
  render(<Header ov={ov({ gaps: gaps({ scrapeStale: true }) })} busy onJob={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Sync" })).toBeDisabled();
});
