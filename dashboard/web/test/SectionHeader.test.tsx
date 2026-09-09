import { fireEvent, render, screen } from "@testing-library/react";
import { SectionHeader } from "../src/components/SectionHeader";

test("default (rule=true) carries the edge rule border and the spec-fixed type scale", () => {
  render(<SectionHeader>Assignments</SectionHeader>);
  const el = screen.getByText("Assignments");
  expect(el.className).toContain("border-b-[3px]");
  expect(el.className).toContain("border-edge");
  expect(el.className).toContain("pb-2");
  expect(el.className).toContain("text-[11px]");
  expect(el.className).toContain("font-bold");
  expect(el.className).toContain("uppercase");
  expect(el.className).toContain("tracking-[0.08em]");
});

test("rule={false} drops the edge rule and uses the muted ink color, keeping the same type scale", () => {
  render(<SectionHeader rule={false}>Deadline</SectionHeader>);
  const el = screen.getByText("Deadline");
  expect(el.className).not.toContain("border-b-[3px]");
  expect(el.className).not.toContain("border-edge");
  expect(el.className).not.toContain("pb-2");
  expect(el.className).toContain("text-[color:var(--color-ink-muted)]");
  expect(el.className).toContain("text-[11px]");
  expect(el.className).toContain("font-bold");
  expect(el.className).toContain("uppercase");
  expect(el.className).toContain("tracking-[0.08em]");
});

test("no info prop renders byte-identically to the pre-InfoTip markup (rule=true)", () => {
  const { container } = render(<SectionHeader>Assignments</SectionHeader>);
  expect(container.innerHTML).toBe(
    '<h2 class="mb-4 text-[11px] font-bold uppercase tracking-[0.08em] border-b-[3px] border-edge pb-2">Assignments</h2>',
  );
});

test("no info prop renders byte-identically to the pre-InfoTip markup (rule=false)", () => {
  const { container } = render(<SectionHeader rule={false}>Deadline</SectionHeader>);
  expect(container.innerHTML).toBe(
    '<h2 class="mb-4 text-[11px] font-bold uppercase tracking-[0.08em] text-[color:var(--color-ink-muted)]">Deadline</h2>',
  );
});

test("info prop renders an InfoTip inside the heading (rule=true)", () => {
  render(<SectionHeader info="Everything not yet submitted.">Assignments</SectionHeader>);
  const btn = screen.getByRole("button", { name: "about Assignments" });
  expect(btn).toBeInTheDocument();
  fireEvent.click(btn);
  expect(screen.getByRole("tooltip").textContent).toBe("Everything not yet submitted.");
});

test("info prop renders an InfoTip inside the heading (rule=false)", () => {
  render(
    <SectionHeader rule={false} info="Explains it.">
      Deadline
    </SectionHeader>,
  );
  const btn = screen.getByRole("button", { name: "about Deadline" });
  expect(btn).toBeInTheDocument();
  fireEvent.click(btn);
  expect(screen.getByRole("tooltip").textContent).toBe("Explains it.");
});

test("info prop keeps the heading's accessible name as just the title, with the tip as its own reachable control", () => {
  render(<SectionHeader info="Everything not yet submitted.">Attendance</SectionHeader>);
  expect(screen.getByRole("heading", { name: "Attendance" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "about Attendance" })).toBeInTheDocument();
});
