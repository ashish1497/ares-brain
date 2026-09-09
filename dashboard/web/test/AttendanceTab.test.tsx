import { fireEvent, render, screen } from "@testing-library/react";
import { AttendanceTab } from "../src/components/AttendanceTab";
import { attendance, overview } from "./factories";
import type { TabProps } from "../src/lib/types";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-09T10:00:00"));
});
afterEach(() => {
  vi.useRealTimers();
});

const baseProps = (over: Partial<TabProps["ov"]> = {}): TabProps => ({
  ov: overview(over),
  onJob: () => {},
  busy: false,
  go: () => {},
  params: [],
});

test("an at-risk row carries the bad tint style and shows its note", () => {
  const { container } = render(
    <AttendanceTab
      {...baseProps({
        attendance: [
          attendance({
            course: "Risky Course",
            state: "risk",
            atRisk: true,
            note: "one more miss and you're capped",
          }),
        ],
      })}
    />,
  );
  expect(screen.getByText("one more miss and you're capped")).toBeInTheDocument();
  const row = screen.getByText("Risky Course").closest("tr");
  expect(row).not.toBeNull();
  expect(row!.getAttribute("style")).toContain("var(--color-bad)");
  expect(container.querySelector('[data-slot="card"]')).toHaveClass("gap-0");
});

test("the Now sort toggle reorders rows numerically", () => {
  render(
    <AttendanceTab
      {...baseProps({
        attendance: [
          attendance({ course: "High", courseSlug: "high", nowPct: 95, state: "ok" }),
          attendance({ course: "Low", courseSlug: "low", nowPct: 40, state: "ok" }),
        ],
      })}
    />,
  );
  const rowsBefore = screen.getAllByRole("row").slice(1); // skip header row
  expect(rowsBefore[0].textContent).toContain("High"); // default: risk desc, both "ok" so stable order
  fireEvent.click(screen.getByRole("columnheader", { name: /Now/ }).querySelector("button")!);
  const rowsAfterAsc = screen.getAllByRole("row").slice(1);
  expect(rowsAfterAsc[0].textContent).toContain("Low");
  fireEvent.click(screen.getByRole("columnheader", { name: /Now/ }).querySelector("button")!);
  const rowsAfterDesc = screen.getAllByRole("row").slice(1);
  expect(rowsAfterDesc[0].textContent).toContain("High");
});

test("the header rule is present", () => {
  render(<AttendanceTab {...baseProps({ attendance: [attendance()] })} />);
  const headerRow = screen.getByRole("columnheader", { name: "Course" }).closest("tr");
  expect(headerRow).toHaveClass("border-b-[3px]");
});

test("attended X of Y is summed from attendance[]", () => {
  render(
    <AttendanceTab
      {...baseProps({
        attendance: [
          attendance({ course: "A", courseSlug: "a", attended: 8, conducted: 10 }),
          attendance({ course: "B", courseSlug: "b", attended: 4, conducted: 5 }),
        ],
        attendanceMin: 75,
      })}
    />,
  );
  expect(screen.getByText(/attended 12 of 15/)).toBeInTheDocument();
  expect(screen.getByText(/assumes ≥ 75%/)).toBeInTheDocument();
});

test("overall / best-case percentages come from ov.kpis, not a client-side recompute", () => {
  render(
    <AttendanceTab
      {...baseProps({
        // Deliberately inconsistent with a naive sum-of-rows recompute (which would give
        // 80% / 90%) so the assertion only passes if the tab reads ov.kpis directly.
        attendance: [
          attendance({ course: "A", courseSlug: "a", attended: 8, conducted: 10 }),
          attendance({ course: "B", courseSlug: "b", attended: 4, conducted: 5 }),
        ],
        kpis: {
          dueThisWeek: 0,
          nextExamInDays: null,
          nextExamName: null,
          cpAvg: null,
          attendanceNow: 33,
          attendanceBestCase: 77,
          brainReady: 0,
          courseCount: 1,
        },
      })}
    />,
  );
  expect(screen.getByText(/33% overall/)).toBeInTheDocument();
  expect(screen.getByText(/best case 77%/)).toBeInTheDocument();
});

test("Now sort cycles risk -> now-asc -> now-desc -> risk (default is reachable again)", () => {
  render(
    <AttendanceTab
      {...baseProps({
        attendance: [
          attendance({ course: "High", courseSlug: "high", nowPct: 95, state: "ok" }),
          attendance({ course: "Low", courseSlug: "low", nowPct: 40, state: "risk" }),
        ],
      })}
    />,
  );
  const nowButton = screen.getByRole("columnheader", { name: /Now/ }).querySelector("button")!;
  // default: risk desc -> risk-state row ("Low") first
  expect(screen.getAllByRole("row").slice(1)[0].textContent).toContain("Low");
  fireEvent.click(nowButton); // now-asc
  fireEvent.click(nowButton); // now-desc
  fireEvent.click(nowButton); // back to risk
  expect(screen.getAllByRole("row").slice(1)[0].textContent).toContain("Low");
});

test("the Floor column header carries an InfoTip with the exact copy", () => {
  render(<AttendanceTab {...baseProps({ attendance: [attendance()] })} />);
  const floorHeader = screen.getByRole("columnheader", { name: /Floor/ });
  const btn = floorHeader.querySelector("button")!;
  fireEvent.click(btn);
  expect(screen.getByRole("tooltip").textContent).toBe(
    "The lowest your attendance can fall to by the end of term if you miss every remaining session.",
  );
});

test("empty attendance renders the empty-state copy", () => {
  render(<AttendanceTab {...baseProps({ attendance: [] })} />);
  expect(screen.getByText("No attendance data.")).toBeInTheDocument();
});
