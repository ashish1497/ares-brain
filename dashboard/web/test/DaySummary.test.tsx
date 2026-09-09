import { render, screen } from "@testing-library/react";
import { computeDaySummaryPoints, DaySummary } from "../src/components/today/DaySummary";
import { attendance, dueSoon, overview, todayClass } from "./factories";

test("the class-count/span point is computed from real fixture times", () => {
  const points = computeDaySummaryPoints(
    overview({
      today: {
        classes: [
          todayClass({ start: "2026-09-09T09:00:00", end: "2026-09-09T10:00:00" }),
          todayClass({ start: "2026-09-09T11:00:00", end: "2026-09-09T12:30:00" }),
        ],
        dueTodayOrTomorrow: [],
        changed: [],
      },
    }),
  );
  expect(points[0]).toBe("2 classes today, 09:00–12:30 (2h 30m in class)");
});

test("a long gap between classes is called out", () => {
  const points = computeDaySummaryPoints(
    overview({
      today: {
        classes: [
          todayClass({ start: "2026-09-09T09:00:00", end: "2026-09-09T10:00:00", course: "A" }),
          todayClass({ start: "2026-09-09T13:00:00", end: "2026-09-09T14:00:00", course: "B" }),
        ],
        dueTodayOrTomorrow: [],
        changed: [],
      },
    }),
  );
  expect(points.some((p) => p.includes("gap between A and B"))).toBe(true);
});

test("fully back-to-back classes get the no-breaks point", () => {
  const points = computeDaySummaryPoints(
    overview({
      today: {
        classes: [
          todayClass({ start: "2026-09-09T09:00:00", end: "2026-09-09T10:00:00" }),
          todayClass({ start: "2026-09-09T10:00:00", end: "2026-09-09T11:00:00" }),
        ],
        dueTodayOrTomorrow: [],
        changed: [],
      },
    }),
  );
  expect(points.some((p) => p.includes("Back-to-back"))).toBe(true);
});

test("the pre-read point counts only classes with a non-empty prereadPaths", () => {
  const points = computeDaySummaryPoints(
    overview({
      today: {
        classes: [
          todayClass({ prereadPaths: ["a.md"] }),
          todayClass({ prereadPaths: [] }),
          todayClass({ prereadPaths: [] }),
        ],
        dueTodayOrTomorrow: [],
        changed: [],
      },
    }),
  );
  expect(
    points.some((p) => p === "1 of 3 classes have a pre-read on file — read before class"),
  ).toBe(true);
});

test("the due-today point names the single item, or switches to a count", () => {
  const single = computeDaySummaryPoints(
    overview({
      today: {
        classes: [],
        dueTodayOrTomorrow: [dueSoon({ title: "Essay 2", course: "Writing" })],
        changed: [],
      },
    }),
  );
  expect(single.some((p) => p === "Essay 2 (Writing) is due")).toBe(true);

  const many = computeDaySummaryPoints(
    overview({
      today: {
        classes: [],
        dueTodayOrTomorrow: [dueSoon({ id: "1" }), dueSoon({ id: "2" })],
        changed: [],
      },
    }),
  );
  expect(many.some((p) => p === "2 items due today or tomorrow")).toBe(true);
});

test("the exam point appears at nextExamInDays 14 and not at 15", () => {
  const base = overview();
  const with14 = computeDaySummaryPoints({
    ...base,
    kpis: { ...base.kpis, nextExamInDays: 14, nextExamName: "Midterm" },
  });
  expect(with14.some((p) => p.includes("Midterm in 14 days"))).toBe(true);

  const with15 = computeDaySummaryPoints({
    ...base,
    kpis: { ...base.kpis, nextExamInDays: 15, nextExamName: "Midterm" },
  });
  expect(with15.some((p) => p.includes("Midterm"))).toBe(false);
});

test("a course below attendanceMin with a class today produces its point", () => {
  const points = computeDaySummaryPoints(
    overview({
      attendanceMin: 80,
      attendance: [attendance({ course: "Finance", courseSlug: "finance", nowPct: 60 })],
      today: {
        classes: [todayClass({ courseSlug: "finance", course: "Finance" })],
        dueTodayOrTomorrow: [],
        changed: [],
      },
    }),
  );
  expect(points.some((p) => p.startsWith("Finance attendance at 60%"))).toBe(true);
});

test("a course below attendanceMin without a class today produces no point", () => {
  const points = computeDaySummaryPoints(
    overview({
      attendanceMin: 80,
      attendance: [attendance({ course: "Finance", courseSlug: "finance", nowPct: 60 })],
      today: {
        classes: [todayClass({ courseSlug: "other-course", course: "Other" })],
        dueTodayOrTomorrow: [],
        changed: [],
      },
    }),
  );
  expect(points.some((p) => p.includes("Finance attendance"))).toBe(false);
});

test("no classes and nothing due renders the calm line and no empty <ul>", () => {
  const points = computeDaySummaryPoints(
    overview({ today: { classes: [], dueTodayOrTomorrow: [], changed: [] } }),
  );
  expect(points).toEqual([]);

  render(
    <DaySummary ov={overview({ today: { classes: [], dueTodayOrTomorrow: [], changed: [] } })} />,
  );
  expect(screen.getByText("Nothing on the schedule today, and nothing due.")).toBeInTheDocument();
  expect(screen.queryByRole("list")).not.toBeInTheDocument();
});
