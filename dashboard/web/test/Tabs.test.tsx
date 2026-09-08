import { render, screen, fireEvent } from "@testing-library/react";
import { Tabs } from "../src/components/Tabs";

test("the active tab carries the pressed classes", () => {
  render(<Tabs active="assignments" counts={{ assignments: 0, gaps: 0 }} onSelect={vi.fn()} />);
  const active = screen.getByRole("button", { name: "Assignments" });
  expect(active).toHaveClass("bg-card");
  expect(active).toHaveClass("border-edge");
  const inactive = screen.getByRole("button", { name: "Today" });
  expect(inactive).not.toHaveClass("bg-card");
});

test("a tab button's internal gap is on the allowed spacing scale (gap-1, not gap-1.5)", () => {
  render(<Tabs active="today" counts={{ assignments: 0, gaps: 9 }} onSelect={vi.fn()} />);
  const btn = screen.getByRole("button", { name: /Gaps/ });
  expect(btn).toHaveClass("gap-1");
  expect(btn).not.toHaveClass("gap-1.5");
});

test("clicking a tab calls onSelect with its id", () => {
  const onSelect = vi.fn();
  render(<Tabs active="today" counts={{ assignments: 0, gaps: 0 }} onSelect={onSelect} />);
  fireEvent.click(screen.getByRole("button", { name: "Exams" }));
  expect(onSelect).toHaveBeenCalledWith("exams");
});

test("the sticky bar is full-bleed while its content is capped at 1400px", () => {
  render(<Tabs active="today" counts={{ assignments: 0, gaps: 0 }} onSelect={vi.fn()} />);
  const nav = screen.getByRole("button", { name: "Today" }).closest("nav")!;
  expect(nav).not.toHaveClass("max-w-[1400px]");
  const inner = nav.querySelector(":scope > div")!;
  expect(inner).toHaveClass("mx-auto");
  expect(inner).toHaveClass("max-w-[1400px]");
});

test("a count badge renders when counts.gaps is nonzero and not when zero", () => {
  const { rerender } = render(
    <Tabs active="today" counts={{ assignments: 0, gaps: 9 }} onSelect={vi.fn()} />,
  );
  expect(screen.getByRole("button", { name: /Gaps/ })).toHaveTextContent("9");

  rerender(<Tabs active="today" counts={{ assignments: 0, gaps: 0 }} onSelect={vi.fn()} />);
  expect(screen.getByRole("button", { name: /Gaps/ })).toHaveTextContent("Gaps");
  expect(screen.getByRole("button", { name: /Gaps/ }).textContent).toBe("Gaps");
});
