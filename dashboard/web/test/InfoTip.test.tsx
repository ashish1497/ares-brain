import { fireEvent, render, screen } from "@testing-library/react";
import { InfoTip } from "../src/components/InfoTip";

test("the trigger has an accessible name", () => {
  render(<InfoTip label="about Floor">Explanation</InfoTip>);
  expect(screen.getByRole("button", { name: "about Floor" })).toBeInTheDocument();
});

test("the panel is absent until opened", () => {
  render(<InfoTip label="about Floor">Explanation</InfoTip>);
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
});

test("it opens on focus", () => {
  render(<InfoTip label="about Floor">Explanation</InfoTip>);
  fireEvent.focus(screen.getByRole("button", { name: "about Floor" }));
  expect(screen.getByRole("tooltip")).toBeInTheDocument();
});

test("it opens on click", () => {
  render(<InfoTip label="about Floor">Explanation</InfoTip>);
  fireEvent.click(screen.getByRole("button", { name: "about Floor" }));
  expect(screen.getByRole("tooltip")).toBeInTheDocument();
});

test("it opens on mouseenter", () => {
  render(<InfoTip label="about Floor">Explanation</InfoTip>);
  fireEvent.mouseEnter(screen.getByRole("button", { name: "about Floor" }));
  expect(screen.getByRole("tooltip")).toBeInTheDocument();
});

test("it closes on Escape", () => {
  render(<InfoTip label="about Floor">Explanation</InfoTip>);
  const btn = screen.getByRole("button", { name: "about Floor" });
  fireEvent.focus(btn);
  expect(screen.getByRole("tooltip")).toBeInTheDocument();
  fireEvent.keyDown(btn, { key: "Escape" });
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
});

test("it closes on blur", () => {
  render(<InfoTip label="about Floor">Explanation</InfoTip>);
  const btn = screen.getByRole("button", { name: "about Floor" });
  fireEvent.focus(btn);
  expect(screen.getByRole("tooltip")).toBeInTheDocument();
  fireEvent.blur(btn);
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
});

test("aria-describedby links the trigger to the panel only while open", () => {
  render(<InfoTip label="about Floor">Explanation</InfoTip>);
  const btn = screen.getByRole("button", { name: "about Floor" });
  expect(btn).not.toHaveAttribute("aria-describedby");
  fireEvent.focus(btn);
  const tooltip = screen.getByRole("tooltip");
  expect(btn.getAttribute("aria-describedby")).toBe(tooltip.id);
  fireEvent.blur(btn);
  expect(btn).not.toHaveAttribute("aria-describedby");
});

test("role=tooltip is present on the panel", () => {
  render(<InfoTip label="about Floor">Explanation</InfoTip>);
  fireEvent.click(screen.getByRole("button", { name: "about Floor" }));
  expect(screen.getByRole("tooltip").textContent).toBe("Explanation");
});
