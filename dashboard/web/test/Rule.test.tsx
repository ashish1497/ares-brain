import { render, screen } from "@testing-library/react";
import { Rule } from "../src/components/Rule";

test("renders a horizontal separator by default", () => {
  render(<Rule />);
  expect(screen.getByRole("separator")).toHaveAttribute("aria-orientation", "horizontal");
});

test("renders a vertical separator when vertical is passed", () => {
  render(<Rule vertical />);
  expect(screen.getByRole("separator")).toHaveAttribute("aria-orientation", "vertical");
});
