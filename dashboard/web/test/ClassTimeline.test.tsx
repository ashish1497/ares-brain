import { render, screen, fireEvent } from "@testing-library/react";
import { ClassTimeline } from "../src/components/today/ClassTimeline";
import { todayClass } from "./factories";

const NOW = new Date("2026-09-09T10:00:00");

test("renders 3 classes", () => {
  render(
    <ClassTimeline
      classes={[
        todayClass({ start: "2026-09-09T09:00:00", end: "2026-09-09T09:30:00", course: "A" }),
        todayClass({ start: "2026-09-09T09:30:00", end: "2026-09-09T10:30:00", course: "B" }),
        todayClass({ start: "2026-09-09T11:00:00", end: "2026-09-09T12:00:00", course: "C" }),
      ]}
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
      classes={[
        todayClass({ start: "2026-09-09T09:00:00", end: "2026-09-09T09:30:00", course: "Past" }),
        todayClass({ start: "2026-09-09T09:30:00", end: "2026-09-09T10:30:00", course: "Now" }),
        todayClass({ start: "2026-09-09T11:00:00", end: "2026-09-09T12:00:00", course: "Future" }),
      ]}
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
  render(
    <ClassTimeline classes={[todayClass({ room: "Room 1", instructor: "Prof X" })]} now={NOW} />,
  );
  expect(screen.getAllByRole("separator")).toHaveLength(1);
});

test("a class with no room shows no leading rule", () => {
  render(<ClassTimeline classes={[todayClass({ room: null, instructor: "Prof X" })]} now={NOW} />);
  expect(screen.queryByRole("separator")).not.toBeInTheDocument();
  expect(screen.getByText("Prof X")).toBeInTheDocument();
});

test("the pre-read chip appears only when prereadPaths is non-empty", () => {
  const { rerender } = render(
    <ClassTimeline classes={[todayClass({ prereadPaths: ["outline.md"] })]} now={NOW} />,
  );
  expect(screen.getByText("pre-read")).toBeInTheDocument();

  rerender(<ClassTimeline classes={[todayClass({ prereadPaths: [] })]} now={NOW} />);
  expect(screen.queryByText("pre-read")).not.toBeInTheDocument();
});

test("the padding and positioning context live on the <li>, not the <ol> — so the dot resolves against the rail", () => {
  render(<ClassTimeline classes={[todayClass()]} now={NOW} />);
  const list = screen.getByRole("list");
  expect(list).not.toHaveClass("pl-4");
  expect(list.querySelector("li")).toHaveClass("pl-4", "relative");
});

test("the header carries an info tooltip, like its sibling Today cards", async () => {
  render(<ClassTimeline classes={[todayClass()]} now={NOW} />);
  const trigger = screen.getByRole("button", { name: "about Today" });
  fireEvent.click(trigger);
  expect(
    screen.getByText("Every class you have today, in order, with the room and instructor."),
  ).toBeInTheDocument();
});

test("empty list shows no classes today", () => {
  render(<ClassTimeline classes={[]} now={NOW} />);
  expect(screen.getByText("no classes today")).toBeInTheDocument();
});

test("the panel gets the card treatment (border, shadow, bg-card)", () => {
  const { container } = render(<ClassTimeline classes={[todayClass()]} now={NOW} />);
  expect(container.firstChild).toHaveClass(
    "rounded-nb",
    "border-[3px]",
    "border-edge",
    "bg-card",
    "shadow-[var(--nb-shadow)]",
    "gap-0",
  );
});
