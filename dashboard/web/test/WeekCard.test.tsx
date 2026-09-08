import { render, screen } from "@testing-library/react";
import { WeekCard } from "../src/components/WeekCard";
import { weekItem } from "./factories";

test("sorts rows by `when` ascending", () => {
  render(
    <WeekCard
      week={[
        weekItem({ when: "2026-09-13", title: "Later" }),
        weekItem({ when: "2026-09-10", title: "Earlier" }),
        weekItem({ when: "2026-09-11", title: "Middle" }),
      ]}
    />,
  );
  const rows = screen.getAllByTestId("week-row");
  expect(rows.map((r) => r.textContent)).toEqual([
    expect.stringContaining("2026-09-10"),
    expect.stringContaining("2026-09-11"),
    expect.stringContaining("2026-09-13"),
  ]);
});

test("renders a copy action for a `copy` action row", () => {
  render(
    <WeekCard
      week={[
        weekItem({
          action: { label: "Start", type: "copy", value: "/mesa:ares-brain-assignment-help" },
        }),
      ]}
    />,
  );
  expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
});

test("empty state", () => {
  render(<WeekCard week={[]} />);
  expect(screen.getByText("Nothing in the next 7 days")).toBeInTheDocument();
});
