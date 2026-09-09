import { act, render, screen, fireEvent } from "@testing-library/react";
import { MindsetModal } from "../src/components/today/MindsetModal";
import { attendance, brain, dueSoon, overview, todayClass } from "./factories";

const stubClipboard = () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  return writeText;
};

test("shows course name and time range", () => {
  const cls = todayClass({
    course: "Finance 101",
    start: "2026-09-09T09:00:00",
    end: "2026-09-09T10:30:00",
  });
  render(<MindsetModal cls={cls} ov={overview()} onClose={vi.fn()} />);
  expect(screen.getByRole("dialog")).toHaveTextContent("Finance 101");
  expect(screen.getByText("09:00–10:30")).toBeInTheDocument();
});

test("lists pre-reads when present", () => {
  const cls = todayClass({ prereadPaths: ["outline.md", "ch3.pdf"] });
  render(<MindsetModal cls={cls} ov={overview()} onClose={vi.fn()} />);
  expect(screen.getByText("outline.md")).toBeInTheDocument();
  expect(screen.getByText("ch3.pdf")).toBeInTheDocument();
});

test("shows the explicit no-pre-read line when empty", () => {
  const cls = todayClass({ prereadPaths: [] });
  render(<MindsetModal cls={cls} ov={overview()} onClose={vi.fn()} />);
  expect(screen.getByText("no pre-read on file for this session")).toBeInTheDocument();
});

test("filters due-today items to this course only", () => {
  const cls = todayClass({ course: "Finance 101" });
  render(
    <MindsetModal
      cls={cls}
      ov={overview({
        today: {
          classes: [cls],
          dueTodayOrTomorrow: [
            dueSoon({ title: "Essay", course: "Finance 101" }),
            dueSoon({ title: "Problem set", course: "Other Course" }),
          ],
          changed: [],
        },
      })}
      onClose={vi.fn()}
    />,
  );
  expect(screen.getByText("Essay")).toBeInTheDocument();
  expect(screen.queryByText("Problem set")).not.toBeInTheDocument();
});

test("brain and attendance blocks are hidden when absent", () => {
  const cls = todayClass({ courseSlug: "unmatched" });
  render(<MindsetModal cls={cls} ov={overview({ brain: [], attendance: [] })} onClose={vi.fn()} />);
  expect(screen.queryByText("attendance")).not.toBeInTheDocument();
});

test("brain and attendance blocks render when present, matched by courseSlug", () => {
  const cls = todayClass({ courseSlug: "finance" });
  render(
    <MindsetModal
      cls={cls}
      ov={overview({
        brain: [brain({ courseSlug: "finance", state: "stale", reason: "2 sources behind" })],
        attendance: [attendance({ courseSlug: "finance", nowPct: 92, state: "ok" })],
      })}
      onClose={vi.fn()}
    />,
  );
  expect(screen.getByText("2 sources behind")).toBeInTheDocument();
  expect(screen.getByText("92%")).toBeInTheDocument();
});

test("meeting link renders only when set", () => {
  const withLink = todayClass({ meetingLink: "https://zoom.example/1" });
  const { rerender } = render(<MindsetModal cls={withLink} ov={overview()} onClose={vi.fn()} />);
  expect(screen.getByRole("link", { name: "Join meeting" })).toHaveAttribute(
    "href",
    "https://zoom.example/1",
  );

  rerender(
    <MindsetModal cls={todayClass({ meetingLink: null })} ov={overview()} onClose={vi.fn()} />,
  );
  expect(screen.queryByRole("link", { name: "Join meeting" })).not.toBeInTheDocument();
});

test("the copy button carries exactly the course-brief command", async () => {
  const writeText = stubClipboard();
  const cls = todayClass({ course: "Corp Finance" });
  render(<MindsetModal cls={cls} ov={overview()} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Copy brief command" }));
  await act(async () => {
    await Promise.resolve();
  });
  expect(writeText).toHaveBeenCalledWith('/mesa:ares-brain-course-brief "Corp Finance"');
});
