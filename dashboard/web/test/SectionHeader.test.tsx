import { render, screen } from "@testing-library/react";
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
