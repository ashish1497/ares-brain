import { render, screen } from "@testing-library/react";
import { TodayTab } from "../src/components/today/TodayTab";
import { changed, dueSoon, overview, todayClass, weekItem } from "./factories";
import type { TabProps } from "../src/lib/types";

const baseProps = (over: Partial<TabProps["ov"]> = {}): TabProps => ({
  ov: overview(over),
  onJob: () => {},
  busy: false,
  go: () => {},
  params: [],
});

test("renders all three panels when data is present", () => {
  render(
    <TodayTab
      {...baseProps({
        today: {
          classes: [todayClass()],
          dueTodayOrTomorrow: [dueSoon()],
          changed: [changed()],
        },
      })}
    />,
  );
  expect(screen.getByText("Today")).toBeInTheDocument();
  expect(screen.getByText("Due now")).toBeInTheDocument();
  expect(screen.getByText("Since last scrape")).toBeInTheDocument();
});

test("all three empty renders the single EmptyToday panel and none of the three", () => {
  render(
    <TodayTab
      {...baseProps({
        today: { classes: [], dueTodayOrTomorrow: [], changed: [] },
      })}
    />,
  );
  expect(screen.getByText("Nothing needs you today.")).toBeInTheDocument();
  expect(screen.queryByText("Due now")).not.toBeInTheDocument();
  expect(screen.queryByText("Since last scrape")).not.toBeInTheDocument();
});

test("the next-class line appears from a thisWeek class entry", () => {
  render(
    <TodayTab
      {...baseProps({
        date: "2026-09-09",
        today: { classes: [], dueTodayOrTomorrow: [], changed: [] },
        thisWeek: [weekItem({ when: "2026-09-11", kind: "class", course: "Finance" })],
      })}
    />,
  );
  expect(screen.getByText(/Next class:/)).toBeInTheDocument();
  expect(screen.getByText(/Finance/)).toBeInTheDocument();
});

test("EmptyToday carries the same card-primitive class contract as the other panels", () => {
  const { container } = render(
    <TodayTab
      {...baseProps({
        today: { classes: [], dueTodayOrTomorrow: [], changed: [] },
      })}
    />,
  );
  expect(container.firstChild).toHaveClass(
    "rounded-nb",
    "border-[3px]",
    "border-edge",
    "bg-card",
    "shadow-[var(--nb-shadow)]",
  );
});

test("the next-class line is absent when there is no future class entry", () => {
  render(
    <TodayTab
      {...baseProps({
        date: "2026-09-09",
        today: { classes: [], dueTodayOrTomorrow: [], changed: [] },
        thisWeek: [weekItem({ when: "2026-09-11", kind: "assignment" })],
      })}
    />,
  );
  expect(screen.queryByText(/Next class:/)).not.toBeInTheDocument();
});
