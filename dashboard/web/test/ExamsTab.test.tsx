import { fireEvent, render, screen } from "@testing-library/react";
import { ExamsTab } from "../src/components/ExamsTab";
import { exam, overview } from "./factories";
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

test("the countdown renders", () => {
  render(
    <ExamsTab
      {...baseProps({
        exams: [exam({ name: "Midterm", date: "2026-09-11T10:00:00", inDays: 2 })],
      })}
    />,
  );
  expect(screen.getByText("2d 0h")).toBeInTheDocument();
});

test("a course-scoped exam's practice-set button carries the interpolated command, no literal <course>", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  render(
    <ExamsTab
      {...baseProps({
        exams: [
          exam({
            name: "Micro Midterm",
            courses: ["micro"],
            courseNames: ["Microeconomics"],
            testprepCommands: [
              { course: "Microeconomics", command: "/mesa:ares-brain-testprep micro" },
            ],
          }),
        ],
      })}
    />,
  );
  const btn = screen.getByRole("button", { name: /Practice set/ });
  fireEvent.click(btn);
  expect(writeText).toHaveBeenCalledWith("/mesa:ares-brain-testprep micro");
  // CopyButton copies via navigator.clipboard — assert no literal placeholder anywhere in DOM
  expect(document.body.textContent).not.toContain("<course>");
  expect(screen.queryByText("<course>")).not.toBeInTheDocument();
});

test("an all-scoped exam's Brief-me buttons use real course names, never the literal 'all' sentinel", () => {
  render(
    <ExamsTab
      {...baseProps({
        exams: [
          exam({
            name: "Finals",
            brainReady: false,
            courses: ["all"],
            courseNames: ["all"],
            testprepCommands: [
              { course: "Microeconomics", command: "/mesa:ares-brain-testprep micro" },
              { course: "Statistics", command: "/mesa:ares-brain-testprep stats" },
            ],
          }),
        ],
      })}
    />,
  );
  const briefButtons = screen.getAllByRole("button", { name: /Brief me/ });
  expect(briefButtons).toHaveLength(2);
  expect(document.body.textContent).not.toContain('"all"');
});

test("more than 3 testprepCommands collapse behind a <details> disclosure labelled with the count", () => {
  render(
    <ExamsTab
      {...baseProps({
        exams: [
          exam({
            name: "End Term",
            courses: ["all"],
            courseNames: ["all"],
            testprepCommands: Array.from({ length: 17 }, (_, i) => ({
              course: `Course ${i}`,
              command: `/mesa:ares-brain-testprep c${i}`,
            })),
          }),
        ],
      })}
    />,
  );
  expect(screen.getByText("17 practice sets")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: /Practice set/ })).toHaveLength(17);
});

test("3 or fewer testprepCommands render inline, no disclosure", () => {
  render(
    <ExamsTab
      {...baseProps({
        exams: [
          exam({
            name: "Quiz",
            courses: ["c1"],
            courseNames: ["Course 1"],
            testprepCommands: [{ course: "Course 1", command: "/mesa:ares-brain-testprep c1" }],
          }),
        ],
      })}
    />,
  );
  expect(screen.queryByText(/practice sets/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Practice set/ })).toBeInTheDocument();
});

test("an all-scoped exam renders one button per course", () => {
  render(
    <ExamsTab
      {...baseProps({
        exams: [
          exam({
            name: "Finals",
            courses: ["all"],
            courseNames: ["all"],
            testprepCommands: [
              { course: "Microeconomics", command: "/mesa:ares-brain-testprep micro" },
              { course: "Statistics", command: "/mesa:ares-brain-testprep stats" },
            ],
          }),
        ],
      })}
    />,
  );
  const buttons = screen.getAllByRole("button", { name: /Practice set/ });
  expect(buttons).toHaveLength(2);
});

test("an all-scoped exam (courses === ['all']) shows the 'all courses' scope label, not the literal 'all'", () => {
  render(
    <ExamsTab
      {...baseProps({
        exams: [exam({ name: "Finals", courses: ["all"], courseNames: ["all"] })],
      })}
    />,
  );
  expect(screen.getByText("all courses")).toBeInTheDocument();
});

test("a course-scoped exam shows its joined course names as scope", () => {
  render(
    <ExamsTab
      {...baseProps({
        exams: [exam({ name: "Micro", courses: ["micro"], courseNames: ["Microeconomics"] })],
      })}
    />,
  );
  expect(screen.getByText("Microeconomics")).toBeInTheDocument();
  expect(screen.queryByText("all courses")).not.toBeInTheDocument();
});

test("brain ready / no practice set pills map correctly", () => {
  render(
    <ExamsTab
      {...baseProps({
        exams: [
          exam({
            name: "Ready Exam",
            brainReady: true,
            testprepExists: false,
            courses: ["c1"],
            courseNames: ["Course 1"],
          }),
        ],
      })}
    />,
  );
  expect(screen.getByText("brain ready")).toBeInTheDocument();
  expect(screen.getByText("no practice set")).toBeInTheDocument();
});

test("brain not ready shows a course-brief CopyButton", () => {
  render(
    <ExamsTab
      {...baseProps({
        exams: [
          exam({
            name: "Not Ready Exam",
            brainReady: false,
            courses: ["c1"],
            courseNames: ["Course 1"],
          }),
        ],
      })}
    />,
  );
  expect(screen.getByText("brain not ready")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Brief me/ })).toBeInTheDocument();
});

test("an all-course exam (>3 courses) collapses Brief-me behind a <details> disclosure, each button naming its course", () => {
  render(
    <ExamsTab
      {...baseProps({
        exams: [
          exam({
            name: "Finals",
            brainReady: false,
            courses: ["all"],
            courseNames: ["all"],
            testprepCommands: Array.from({ length: 17 }, (_, i) => ({
              course: `Course ${i}`,
              command: `/mesa:ares-brain-testprep c${i}`,
            })),
          }),
        ],
      })}
    />,
  );
  expect(screen.getByText("17 briefs")).toBeInTheDocument();
  for (let i = 0; i < 17; i++) {
    expect(screen.getByRole("button", { name: `Brief me — Course ${i}` })).toBeInTheDocument();
  }
});

test("a 1-command exam's Brief-me renders inline, no disclosure", () => {
  render(
    <ExamsTab
      {...baseProps({
        exams: [
          exam({
            name: "Quiz",
            brainReady: false,
            courses: ["c1"],
            courseNames: ["Course 1"],
            testprepCommands: [{ course: "Course 1", command: "/mesa:ares-brain-testprep c1" }],
          }),
        ],
      })}
    />,
  );
  expect(screen.queryByText(/briefs/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Brief me — Course 1" })).toBeInTheDocument();
});

test("a single practice-set button is the cta (bg-cta); many practice-set buttons are all neutral", () => {
  const { rerender } = render(
    <ExamsTab
      {...baseProps({
        exams: [
          exam({
            name: "Quiz",
            courses: ["c1"],
            courseNames: ["Course 1"],
            testprepCommands: [{ course: "Course 1", command: "/mesa:ares-brain-testprep c1" }],
          }),
        ],
      })}
    />,
  );
  expect(screen.getByRole("button", { name: "Practice set" }).className).toContain("bg-cta");

  rerender(
    <ExamsTab
      {...baseProps({
        exams: [
          exam({
            name: "Finals",
            courses: ["all"],
            courseNames: ["all"],
            testprepCommands: [
              { course: "Microeconomics", command: "/mesa:ares-brain-testprep micro" },
              { course: "Statistics", command: "/mesa:ares-brain-testprep stats" },
            ],
          }),
        ],
      })}
    />,
  );
  const buttons = screen.getAllByRole("button", { name: "Practice set" });
  expect(buttons).toHaveLength(2);
  for (const btn of buttons) {
    expect(btn.className).not.toContain("bg-cta");
    expect(btn.className).toContain("bg-card");
  }
});

test("a course-scoped exam card has exactly one cta button, and it is Practice set, not Brief me", () => {
  render(
    <ExamsTab
      {...baseProps({
        exams: [
          exam({
            name: "Marketing Midterm",
            brainReady: false,
            courses: ["mkt"],
            courseNames: ["Crafting Marketing Strategies with Prof. Siddarth Menon"],
            testprepCommands: [
              {
                course: "Crafting Marketing Strategies with Prof. Siddarth Menon",
                command: "/mesa:ares-brain-testprep mkt",
              },
            ],
          }),
        ],
      })}
    />,
  );
  const ctaButtons = screen
    .getAllByRole("button")
    .filter((btn) => btn.className.includes("bg-cta"));
  expect(ctaButtons).toHaveLength(1);
  expect(ctaButtons[0]).toBe(screen.getByRole("button", { name: "Practice set" }));
  expect(
    screen.getByRole("button", {
      name: "Brief me — Crafting Marketing Strategies with Prof. Siddarth Menon",
    }).className,
  ).not.toContain("bg-cta");
});

test("a single Brief-me button is the cta (bg-cta); many Brief-me buttons are all neutral", () => {
  render(
    <ExamsTab
      {...baseProps({
        exams: [
          exam({
            name: "Finals",
            brainReady: false,
            courses: ["all"],
            courseNames: ["all"],
            testprepCommands: [
              { course: "Microeconomics", command: "/mesa:ares-brain-testprep micro" },
              { course: "Statistics", command: "/mesa:ares-brain-testprep stats" },
            ],
          }),
        ],
      })}
    />,
  );
  const buttons = screen.getAllByRole("button", { name: /Brief me/ });
  expect(buttons).toHaveLength(2);
  for (const btn of buttons) {
    expect(btn.className).not.toContain("bg-cta");
    expect(btn.className).toContain("bg-card");
  }
});

test("no literal middot separators anywhere", () => {
  const { container } = render(
    <ExamsTab
      {...baseProps({
        exams: [exam({ name: "Test", courses: ["c1"], courseNames: ["Course 1"] })],
      })}
    />,
  );
  expect(container.textContent).not.toContain("·");
});
