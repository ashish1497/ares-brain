import { render, screen } from "@testing-library/react";
import { KpiStrip } from "../src/components/KpiStrip";
import { kpis } from "./factories";

test("renders 5 tiles", () => {
  render(<KpiStrip k={kpis()} min={75} />);
  expect(screen.getAllByTestId("kpi-tile")).toHaveLength(5);
});

test("the exam tile gets the amber class when nextExamInDays = 6", () => {
  render(<KpiStrip k={kpis({ nextExamInDays: 6, nextExamName: "Mid Term" })} min={75} />);
  const tiles = screen.getAllByTestId("kpi-tile");
  const examTile = tiles.find((t) => t.textContent?.includes("Next exam"))!;
  expect(examTile.className).toContain("bg-soon");
});

test("no amber when the next exam is far out", () => {
  render(<KpiStrip k={kpis({ nextExamInDays: 20 })} min={75} />);
  const tiles = screen.getAllByTestId("kpi-tile");
  const examTile = tiles.find((t) => t.textContent?.includes("Next exam"))!;
  expect(examTile.className).not.toContain("bg-soon");
});

test("amber attendance tile when below the minimum", () => {
  render(<KpiStrip k={kpis({ attendanceNow: 70 })} min={75} />);
  const tiles = screen.getAllByTestId("kpi-tile");
  const att = tiles.find((t) => t.textContent?.includes("Attendance"))!;
  expect(att.className).toContain("bg-soon");
});
