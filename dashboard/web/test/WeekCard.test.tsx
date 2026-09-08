import { render, screen } from "@testing-library/react";
import { WeekCard } from "../src/components/WeekCard";
import { weekItem } from "./factories";

test("orders rows by `when` ascending and groups them under a day heading", () => {
  render(
    <WeekCard
      week={[
        weekItem({ when: "2099-12-12", title: "C" }),
        weekItem({ when: "2099-12-10", title: "A" }),
        weekItem({ when: "2099-12-11", title: "B" }),
      ]}
    />,
  );
  const rows = screen.getAllByTestId("week-row");
  expect(rows.map((r) => r.textContent?.charAt(0))).toEqual(["A", "B", "C"]);
});

test("formats `when` as a short weekday-date, not the raw ISO string", () => {
  render(<WeekCard week={[weekItem({ when: "2099-12-31", title: "Exam" })]} />);
  expect(screen.getByText(/Dec/)).toBeInTheDocument();
  expect(screen.getByText(/31/)).toBeInTheDocument();
  expect(screen.queryByText(/2099-12-31/)).not.toBeInTheDocument();
});

test("filters out items dated before today", () => {
  render(
    <WeekCard
      week={[
        weekItem({ when: "2020-01-01", title: "Past" }),
        weekItem({ when: "2099-12-31", title: "Future" }),
      ]}
    />,
  );
  const rows = screen.getAllByTestId("week-row");
  expect(rows).toHaveLength(1);
  expect(rows[0]).toHaveTextContent("Future");
  expect(screen.queryByText("Past")).not.toBeInTheDocument();
});

test("prints the course only when it differs from the title", () => {
  render(
    <WeekCard
      week={[
        weekItem({
          when: "2099-12-15",
          title: "Fundamentals of Finance",
          course: "Fundamentals of Finance",
        }),
      ]}
    />,
  );
  const row = screen.getByTestId("week-row");
  expect(row).toHaveTextContent("Fundamentals of Finance");
  expect(row.textContent).toBe("Fundamentals of Finance");
});

test("renders a copy action for a `copy` action row", () => {
  render(
    <WeekCard
      week={[
        weekItem({
          when: "2099-12-15",
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

test("empty state when every item is in the past", () => {
  render(<WeekCard week={[weekItem({ when: "2020-01-01" })]} />);
  expect(screen.getByText("Nothing in the next 7 days")).toBeInTheDocument();
});
