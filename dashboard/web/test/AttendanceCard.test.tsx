import { render, screen } from "@testing-library/react";
import { AttendanceCard } from "../src/components/AttendanceCard";
import { attendance } from "./factories";

test("styles the at-risk row and shows its note", () => {
  render(
    <AttendanceCard
      min={75}
      rows={[
        attendance({
          courseSlug: "ok-course",
          course: "OK Course",
          state: "ok",
          atRisk: false,
          note: "",
        }),
        attendance({
          courseSlug: "risk-course",
          course: "Risk Course",
          state: "risk",
          atRisk: true,
          note: "one more miss drops below 75%",
        }),
      ]}
    />,
  );
  const rows = screen.getAllByTestId("attendance-row");
  const okRow = rows.find((r) => r.textContent?.includes("OK Course"))!;
  const riskRow = rows.find((r) => r.textContent?.includes("Risk Course"))!;

  expect(riskRow.className).toContain("border-l-4");
  expect(okRow.className).not.toContain("border-l-4");
  expect(screen.getByText("one more miss drops below 75%")).toBeInTheDocument();
});

test("maps state to the RiskBadge fill (watch -> soon)", () => {
  render(
    <AttendanceCard
      min={75}
      rows={[attendance({ state: "watch", atRisk: true, note: "at the line" })]}
    />,
  );
  expect(screen.getByText("watch").className).toContain("bg-soon");
});

test("assumed minimum is shown", () => {
  render(<AttendanceCard min={75} rows={[]} />);
  expect(screen.getByText("assumed ≥75%")).toBeInTheDocument();
});
