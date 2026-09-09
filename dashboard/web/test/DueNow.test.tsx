import { render, screen } from "@testing-library/react";
import { DueNow } from "../src/components/today/DueNow";
import { assignment, dueSoon } from "./factories";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-09T10:00:00"));
});
afterEach(() => {
  vi.useRealTimers();
});

test("submitted rows sort last and render struck", () => {
  render(
    <DueNow
      items={[
        dueSoon({ id: "s1", title: "Submitted first", submitted: true }),
        dueSoon({ id: "u1", title: "Not submitted", submitted: false }),
      ]}
      assignments={[]}
      go={() => {}}
    />,
  );
  const rows = screen.getAllByText(/Submitted first|Not submitted/);
  expect(rows[0]).toHaveTextContent("Not submitted");
  expect(rows[1]).toHaveTextContent("Submitted first");
  expect(screen.getByText("Submitted first").parentElement).toHaveClass("line-through");
});

test("Open → on a matched item navigates to the assignments/<slug>/<id> hash", () => {
  const go = vi.fn();
  render(
    <DueNow
      items={[dueSoon({ id: "a1", title: "Matched" })]}
      assignments={[assignment({ id: "a1", courseSlug: "sell" })]}
      go={go}
    />,
  );
  screen.getByText("Open →").click();
  expect(go).toHaveBeenCalledWith("assignments/sell/a1");
});

test("Open → on an unmatched item navigates to the assignments tab", () => {
  const go = vi.fn();
  render(
    <DueNow
      items={[dueSoon({ id: "no-match", title: "Unmatched" })]}
      assignments={[assignment({ id: "a1", courseSlug: "sell" })]}
      go={go}
    />,
  );
  screen.getByText("Open →").click();
  expect(go).toHaveBeenCalledWith("assignments");
});

test("hoursAway < 6 shows the soon pill; >= 6 shows relTime instead", () => {
  render(
    <DueNow
      items={[
        dueSoon({ id: "a1", title: "Soon", hoursAway: 3, dueAt: "2026-09-09T20:00:00" }),
        dueSoon({ id: "a2", title: "Later", hoursAway: 20, dueAt: "2026-09-10T12:00:00" }),
      ]}
      assignments={[]}
      go={() => {}}
    />,
  );
  // exactly one soon pill — for the < 6h item, not the >= 6h one
  expect(screen.getAllByText("soon")).toHaveLength(1);
  // the >= 6h item shows the deterministic relTime string instead of a pill
  expect(screen.getByText("in 1d")).toBeInTheDocument();
});

test("hoursAway exactly at the 6h boundary shows relTime, not the soon pill", () => {
  render(
    <DueNow
      items={[dueSoon({ id: "a1", title: "Boundary", hoursAway: 6, dueAt: "2026-09-09T16:00:00" })]}
      assignments={[]}
      go={() => {}}
    />,
  );
  expect(screen.queryByText("soon")).not.toBeInTheDocument();
  expect(screen.getByText("in 6h")).toBeInTheDocument();
});

test("hoursAway just under the 6h boundary shows the soon pill", () => {
  render(
    <DueNow
      items={[
        dueSoon({ id: "a1", title: "Just under", hoursAway: 5.9, dueAt: "2026-09-09T15:54:00" }),
      ]}
      assignments={[]}
      go={() => {}}
    />,
  );
  expect(screen.getByText("soon")).toBeInTheDocument();
});

test("the panel gets the card treatment (border, shadow, bg-card)", () => {
  const { container } = render(<DueNow items={[dueSoon()]} assignments={[]} go={() => {}} />);
  expect(container.firstChild).toHaveClass(
    "rounded-nb",
    "border-[3px]",
    "border-edge",
    "bg-card",
    "shadow-[var(--nb-shadow)]",
    "gap-0",
  );
});

test("a negative hoursAway (already overdue) shows the overdue pill, not soon", () => {
  render(
    <DueNow
      items={[
        dueSoon({ id: "a1", title: "Late thing", hoursAway: -2, dueAt: "2026-09-09T08:00:00" }),
      ]}
      assignments={[]}
      go={() => {}}
    />,
  );
  expect(screen.getByText("overdue")).toBeInTheDocument();
  expect(screen.queryByText("soon")).not.toBeInTheDocument();
});
