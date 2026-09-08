import { render, screen, fireEvent } from "@testing-library/react";
import { AssignmentsCard } from "../src/components/AssignmentsCard";
import { assignment } from "./factories";

test("keeps the given (risk-desc) order and renders the grade picture", () => {
  render(
    <AssignmentsCard
      assignments={[
        assignment({ id: "a", title: "High risk", risk: 0.9, weightPct: 30 }),
        assignment({ id: "b", title: "Low risk", risk: 0.1, weightPct: null }),
      ]}
      grade={[
        {
          course: "Power of Communication",
          courseSlug: "power-of-communication",
          components: [],
          aheadPct: 40,
          summary: "40% of grade still ahead",
        },
      ]}
    />,
  );
  const rows = screen.getAllByTestId("assignment-row");
  expect(rows[0]).toHaveTextContent("High risk");
  expect(rows[1]).toHaveTextContent("Low risk");
  expect(screen.getByText(/40% of grade still ahead/)).toBeInTheDocument();
});

test("a null weightPct shows `ungraded`", () => {
  render(<AssignmentsCard grade={[]} assignments={[assignment({ weightPct: null })]} />);
  expect(screen.getByText(/ungraded/)).toBeInTheDocument();
});

test("the copy button carries the assignment's helpCommand", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  render(
    <AssignmentsCard
      grade={[]}
      assignments={[assignment({ helpCommand: '/mesa:ares-brain-assignment-help "C" "T"' })]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Start" }));
  expect(writeText).toHaveBeenCalledWith('/mesa:ares-brain-assignment-help "C" "T"');
  expect(await screen.findByText("copied — paste in Claude Code")).toBeInTheDocument();
});
