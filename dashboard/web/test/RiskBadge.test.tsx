import { render, screen } from "@testing-library/react";
import { RiskBadge } from "../src/components/RiskBadge";

test("renders the matching fill class per state", () => {
  const { rerender } = render(<RiskBadge state="ok" />);
  expect(screen.getByText("on track").className).toContain("bg-ok");
  rerender(<RiskBadge state="soon" />);
  expect(screen.getByText("watch").className).toContain("bg-soon");
  rerender(<RiskBadge state="bad" />);
  expect(screen.getByText("at risk").className).toContain("bg-bad");
});

test("bands a numeric risk to a state", () => {
  const { rerender } = render(<RiskBadge risk={0.8}>high</RiskBadge>);
  expect(screen.getByText("high").className).toContain("bg-bad");
  rerender(<RiskBadge risk={0.4}>mid</RiskBadge>);
  expect(screen.getByText("mid").className).toContain("bg-soon");
  rerender(<RiskBadge risk={0.1}>low</RiskBadge>);
  expect(screen.getByText("low").className).toContain("bg-ok");
});
