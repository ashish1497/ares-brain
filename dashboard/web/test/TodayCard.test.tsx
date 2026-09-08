import { render, screen } from "@testing-library/react";
import { TodayCard } from "../src/components/TodayCard";
import type { OverviewToday } from "../src/api";

const empty: OverviewToday = { classes: [], dueTodayOrTomorrow: [], changed: {} };

test("shows empty states when nothing is on today", () => {
  render(<TodayCard today={empty} />);
  expect(screen.getByText("No classes today")).toBeInTheDocument();
  expect(screen.getByText("Nothing due")).toBeInTheDocument();
});

test("renders classes, due items and the changed digest", () => {
  render(
    <TodayCard
      today={{
        classes: [
          {
            start: "09:00",
            end: "10:30",
            course: "Power of Communication",
            courseSlug: "power-of-communication",
            room: "R1",
            instructor: null,
            meetingLink: null,
            prereadPaths: ["notes/s1.md"],
          },
        ],
        dueTodayOrTomorrow: [
          {
            title: "Pitch 1",
            course: "Power of Communication",
            dueAt: "2026-09-09T18:00:00Z",
            hoursAway: 9.4,
            submitted: false,
            isClub: false,
            submissionType: "file",
          },
        ],
        changed: { "power-of-communication": { material: 2, announcement: 1 } },
      }}
    />,
  );
  expect(screen.getByText(/09:00/)).toBeInTheDocument();
  expect(screen.getByText(/R1/)).toBeInTheDocument();
  expect(screen.getByText(/Pitch 1 — Power of Communication · in 9h/)).toBeInTheDocument();
  expect(
    screen.getByText(/power-of-communication: 2 material, 1 announcement/),
  ).toBeInTheDocument();
});
