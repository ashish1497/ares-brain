import { render, screen } from "@testing-library/react";
import { AssignmentsTab } from "../src/components/assignments/AssignmentsTab";
import { assignment, overview } from "./factories";
import type { TabProps } from "../src/lib/types";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-09T10:00:00"));
});
afterEach(() => {
  vi.useRealTimers();
});

const baseProps = (over: Partial<TabProps["ov"]> = {}, params: string[] = []): TabProps => ({
  ov: overview(over),
  onJob: () => {},
  busy: false,
  go: () => {},
  params,
});

test("rows render in the payload's risk order — no client resort", () => {
  render(
    <AssignmentsTab
      {...baseProps({
        assignments: [
          assignment({ id: "a1", courseSlug: "c1", title: "First (highest risk)", risk: 0.9 }),
          assignment({ id: "a2", courseSlug: "c1", title: "Second", risk: 0.5 }),
          assignment({
            id: "a3",
            courseSlug: "c1",
            title: "Zzz would sort first alphabetically",
            risk: 0.1,
          }),
        ],
      })}
    />,
  );
  const titles = screen
    .getAllByRole("button")
    .map((btn) => btn.textContent ?? "")
    .filter((text) =>
      /First \(highest risk\)|Second|Zzz would sort first alphabetically/.test(text),
    );
  expect(titles[0]).toContain("First (highest risk)");
  expect(titles[1]).toContain("Second");
  expect(titles[2]).toContain("Zzz would sort first alphabetically");
});

test("weightPct: null renders ungraded", () => {
  render(
    <AssignmentsTab
      {...baseProps({
        assignments: [assignment({ id: "a1", courseSlug: "c1", title: "Solo", weightPct: null })],
      })}
    />,
  );
  expect(screen.getAllByText("ungraded").length).toBeGreaterThan(0);
});

test("clicking a row calls go with assignments/<slug>/<id>", () => {
  const go = vi.fn();
  const props = baseProps({
    assignments: [assignment({ id: "a1", courseSlug: "sell", title: "Clickable row" })],
  });
  render(<AssignmentsTab {...props} go={go} />);
  screen.getByText("Clickable row").click();
  expect(go).toHaveBeenCalledWith("assignments/sell/a1");
});

test("a row with id: null is not clickable", () => {
  const go = vi.fn();
  const props = baseProps({
    assignments: [assignment({ id: null, courseSlug: "sell", title: "No id row" })],
  });
  render(<AssignmentsTab {...props} go={go} />);
  expect(screen.queryByRole("button", { name: /No id row/ })).not.toBeInTheDocument();
  screen.getByText("No id row").click();
  expect(go).not.toHaveBeenCalled();
});

test("an overdue due-label carries the bad class", () => {
  render(
    <AssignmentsTab
      {...baseProps({
        assignments: [
          assignment({
            id: "a1",
            courseSlug: "c1",
            title: "Overdue thing",
            dueAt: "2026-09-08T10:00:00",
            hoursAway: -24,
          }),
        ],
      })}
    />,
  );
  expect(screen.getByText("overdue")).toHaveClass("text-bad");
});

test("header MetaRow computes open count, due-this-week count (hoursAway >= 0 && <= 168), and the worst item", () => {
  render(
    <AssignmentsTab
      {...baseProps({
        assignments: [
          assignment({
            id: "a1",
            courseSlug: "c1",
            title: "Worst one",
            risk: 0.9,
            weightPct: 30,
            hoursAway: 10,
          }),
          assignment({
            id: "a2",
            courseSlug: "c1",
            title: "Due this week too",
            risk: 0.5,
            hoursAway: 168,
          }),
          assignment({
            id: "a3",
            courseSlug: "c1",
            title: "Not due soon",
            risk: 0.1,
            hoursAway: 200,
          }),
          assignment({
            id: "a4",
            courseSlug: "c1",
            title: "Overdue — 14 days late",
            risk: 0.05,
            hoursAway: -351.4,
          }),
        ],
      })}
    />,
  );
  expect(screen.getByText("4 open")).toBeInTheDocument();
  expect(screen.getByText("2 due this week")).toBeInTheDocument();
  expect(screen.getByText("worst: Worst one (30%)")).toBeInTheDocument();
});

test("empty list renders 'Nothing open.'", () => {
  render(<AssignmentsTab {...baseProps({ assignments: [] })} />);
  expect(screen.getByText("Nothing open.")).toBeInTheDocument();
});

test("params.length >= 2 renders the focused page instead of the list", () => {
  render(
    <AssignmentsTab
      {...baseProps(
        { assignments: [assignment({ id: "a1", courseSlug: "c1", title: "Focused target" })] },
        ["c1", "a1"],
      )}
    />,
  );
  expect(screen.getByText("Focused target")).toBeInTheDocument();
  expect(screen.queryByText("Nothing open.")).not.toBeInTheDocument();
  expect(screen.getByText(/all assignments/)).toBeInTheDocument();
});

test("params shorter than 2 renders the list", () => {
  render(<AssignmentsTab {...baseProps({ assignments: [] }, ["c1"])} />);
  expect(screen.getByText("Nothing open.")).toBeInTheDocument();
});

test("the status square is size-4 (not size-3) so its fill core is legible", () => {
  const { container } = render(
    <AssignmentsTab
      {...baseProps({
        assignments: [assignment({ id: "a1", courseSlug: "c1", title: "Row" })],
      })}
    />,
  );
  const square = container.querySelector("[aria-hidden]");
  expect(square).toHaveClass("size-4");
  expect(square).not.toHaveClass("size-3");
});

test("the list Card takes gap-0 so child margins don't double-count against the flex gap", () => {
  const { container } = render(<AssignmentsTab {...baseProps({ assignments: [] })} />);
  const card = container.querySelector('[data-slot="card"]');
  expect(card).toHaveClass("gap-0");
});
