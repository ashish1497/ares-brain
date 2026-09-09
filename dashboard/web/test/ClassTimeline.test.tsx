import { render, screen, fireEvent } from "@testing-library/react";
import { ClassTimeline } from "../src/components/today/ClassTimeline";
import { overview, todayClass } from "./factories";

const NOW = new Date("2026-09-09T10:00:00");

// `ClassTimeline` now takes the full `ov: Overview` (not just `classes`) because the added
// per-class "Mindset" modal cross-references `ov.today.dueTodayOrTomorrow`, `ov.brain`, and
// `ov.attendance` by `courseSlug` — see task-7-report.md for why this legitimately changed the
// component's DOM/props over the previous round.
const withClasses = (classes: ReturnType<typeof todayClass>[]) =>
  overview({ today: { classes, dueTodayOrTomorrow: [], changed: [] } });

test("renders 3 classes", () => {
  render(
    <ClassTimeline
      ov={withClasses([
        todayClass({ start: "2026-09-09T09:00:00", end: "2026-09-09T09:30:00", course: "A" }),
        todayClass({ start: "2026-09-09T09:30:00", end: "2026-09-09T10:30:00", course: "B" }),
        todayClass({ start: "2026-09-09T11:00:00", end: "2026-09-09T12:00:00", course: "C" }),
      ])}
      now={NOW}
    />,
  );
  expect(screen.getByText("A")).toBeInTheDocument();
  expect(screen.getByText("B")).toBeInTheDocument();
  expect(screen.getByText("C")).toBeInTheDocument();
});

test("a class spanning `now` gets the now dot treatment; others get future/past", () => {
  render(
    <ClassTimeline
      ov={withClasses([
        todayClass({ start: "2026-09-09T09:00:00", end: "2026-09-09T09:30:00", course: "Past" }),
        todayClass({ start: "2026-09-09T09:30:00", end: "2026-09-09T10:30:00", course: "Now" }),
        todayClass({ start: "2026-09-09T11:00:00", end: "2026-09-09T12:00:00", course: "Future" }),
      ])}
      now={NOW}
    />,
  );
  const dots = screen.getAllByTestId("class-dot");
  expect(dots[0]).toHaveAttribute("data-state", "past");
  expect(dots[1]).toHaveAttribute("data-state", "now");
  expect(dots[2]).toHaveAttribute("data-state", "future");
  // guard the rendering itself, not just the classifier: the now dot must actually be filled `ok`
  expect(dots[0]).toHaveClass("bg-[color:var(--color-ink-muted)]");
  expect(dots[1]).toHaveClass("bg-ok");
  expect(dots[2]).toHaveClass("bg-card");
});

test("MetaRow puts a rule between room and instructor", () => {
  const { container } = render(
    <ClassTimeline
      ov={withClasses([todayClass({ room: "Room 1", instructor: "Prof X" })])}
      now={NOW}
    />,
  );
  // scoped to the class row (an <ol><li>) — the day summary above it is a <ul><li> too
  const row = container.querySelector("ol li")!;
  expect(row.querySelectorAll('[role="separator"]')).toHaveLength(1);
});

test("a class with no room shows no leading rule", () => {
  const { container } = render(
    <ClassTimeline
      ov={withClasses([todayClass({ room: null, instructor: "Prof X" })])}
      now={NOW}
    />,
  );
  const row = container.querySelector("ol li")!;
  expect(row.querySelector('[role="separator"]')).not.toBeInTheDocument();
  expect(screen.getByText("Prof X")).toBeInTheDocument();
});

test("the pre-read chip appears only when prereadPaths is non-empty", () => {
  const { rerender } = render(
    <ClassTimeline ov={withClasses([todayClass({ prereadPaths: ["outline.md"] })])} now={NOW} />,
  );
  expect(screen.getByText("pre-read")).toBeInTheDocument();

  rerender(<ClassTimeline ov={withClasses([todayClass({ prereadPaths: [] })])} now={NOW} />);
  expect(screen.queryByText("pre-read")).not.toBeInTheDocument();
});

test("the pre-read chip does not use bg-accent + text-black (fails contrast at 11px)", () => {
  render(
    <ClassTimeline ov={withClasses([todayClass({ prereadPaths: ["outline.md"] })])} now={NOW} />,
  );
  const chip = screen.getByText("pre-read");
  expect(chip.className).not.toContain("bg-accent");
  expect(chip.className).not.toContain("text-black");
});

test("the padding and positioning context live on the <li>, not the <ol> — so the dot resolves against the rail", () => {
  const { container } = render(<ClassTimeline ov={withClasses([todayClass()])} now={NOW} />);
  // scoped to <ol> specifically — the day summary above it also renders a <ul> "list"
  const list = container.querySelector("ol")!;
  expect(list).not.toHaveClass("pl-4");
  expect(list.querySelector("li")).toHaveClass("pl-4", "relative");
});

test("the header carries an info tooltip, like its sibling Today cards", async () => {
  render(<ClassTimeline ov={withClasses([todayClass()])} now={NOW} />);
  const trigger = screen.getByRole("button", { name: "about Today" });
  fireEvent.click(trigger);
  expect(
    screen.getByText("Every class you have today, in order, with the room and instructor."),
  ).toBeInTheDocument();
});

test("empty list shows no classes today", () => {
  render(<ClassTimeline ov={withClasses([])} now={NOW} />);
  expect(screen.getByText("no classes today")).toBeInTheDocument();
});

test("the panel gets the card treatment (border, shadow, bg-card)", () => {
  const { container } = render(<ClassTimeline ov={withClasses([todayClass()])} now={NOW} />);
  expect(container.firstChild).toHaveClass(
    "rounded-nb",
    "border-[3px]",
    "border-edge",
    "bg-card",
    "shadow-[var(--nb-shadow)]",
    "gap-0",
  );
});

test("the day summary sits above a horizontal-rule divider above the timeline", () => {
  const { container } = render(<ClassTimeline ov={withClasses([todayClass()])} now={NOW} />);
  expect(screen.getByText("Today at a glance")).toBeInTheDocument();
  const horizontalRule = container.querySelector(
    '[role="separator"][aria-orientation="horizontal"]',
  );
  expect(horizontalRule).not.toBeNull();
});

test("the Mindset trigger is neutral, one per class, and never the cta variant", () => {
  render(
    <ClassTimeline
      ov={withClasses([todayClass({ course: "A" }), todayClass({ course: "B" })])}
      now={NOW}
    />,
  );
  const buttons = screen.getAllByRole("button", { name: "Mindset" });
  expect(buttons).toHaveLength(2);
  for (const b of buttons) {
    expect(b).not.toHaveClass("bg-cta");
  }
});

test("clicking a class's Mindset button opens the modal for that class", () => {
  render(
    <ClassTimeline
      ov={withClasses([
        todayClass({
          course: "Course A",
          start: "2026-09-09T09:00:00",
          end: "2026-09-09T10:00:00",
        }),
        todayClass({
          course: "Course B",
          start: "2026-09-09T11:00:00",
          end: "2026-09-09T12:00:00",
        }),
      ])}
      now={NOW}
    />,
  );
  const buttons = screen.getAllByRole("button", { name: "Mindset" });
  fireEvent.click(buttons[1]);
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveTextContent("Course B");
  expect(dialog).toHaveTextContent("11:00–12:00");
  expect(dialog).not.toHaveTextContent("Course A");
});
