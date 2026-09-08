import { render, screen } from "@testing-library/react";
import { StatePill } from "../src/components/StatePill";

test("maps state ok/soon/bad/neutral to their fill classes", () => {
  const { rerender } = render(<StatePill state="ok">on track</StatePill>);
  expect(screen.getByText("on track")).toHaveClass("bg-ok");

  rerender(<StatePill state="soon">watch</StatePill>);
  expect(screen.getByText("watch")).toHaveClass("bg-soon");

  rerender(<StatePill state="bad">at risk</StatePill>);
  expect(screen.getByText("at risk")).toHaveClass("bg-bad");

  rerender(<StatePill state="neutral">—</StatePill>);
  expect(screen.getByText("—")).toHaveClass("bg-card");
});
