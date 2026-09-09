import { act, render, screen } from "@testing-library/react";
import { AssignmentPage } from "../src/components/assignments/AssignmentPage";
import { assignment, overview } from "./factories";

const stubClipboard = (writeText = vi.fn().mockResolvedValue(undefined)) => {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  return writeText;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-09T10:00:00"));
});
afterEach(() => {
  vi.useRealTimers();
});

test("renders instructionsText split on \\n\\n into separate paragraphs", () => {
  const ov = overview({
    assignments: [
      assignment({ id: "a1", courseSlug: "c1", instructionsText: "Para one.\n\nPara two." }),
    ],
  });
  render(<AssignmentPage ov={ov} slug="c1" id="a1" go={() => {}} />);
  expect(screen.getByText("Para one.")).toBeInTheDocument();
  expect(screen.getByText("Para two.")).toBeInTheDocument();
});

test("a single \\n does not split into paragraphs — whitespace-pre-line preserves the line break", () => {
  const ov = overview({
    assignments: [assignment({ id: "a1", courseSlug: "c1", instructionsText: "A\nB" })],
  });
  const { container } = render(<AssignmentPage ov={ov} slug="c1" id="a1" go={() => {}} />);
  const paragraphs = container.querySelectorAll("p.whitespace-pre-line");
  expect(paragraphs.length).toBe(1);
  expect(paragraphs[0].textContent).toBe("A\nB");
});

test("a windows-style blank line (\\r\\n\\r\\n) splits into separate paragraphs", () => {
  const ov = overview({
    assignments: [
      assignment({ id: "a1", courseSlug: "c1", instructionsText: "Para one.\r\n\r\nPara two." }),
    ],
  });
  const { container } = render(<AssignmentPage ov={ov} slug="c1" id="a1" go={() => {}} />);
  const paragraphs = container.querySelectorAll("p.whitespace-pre-line");
  expect(paragraphs.length).toBe(2);
  expect(screen.getByText("Para one.")).toBeInTheDocument();
  expect(screen.getByText("Para two.")).toBeInTheDocument();
});

test("empty instructions renders the fallback line", () => {
  const ov = overview({
    assignments: [assignment({ id: "a1", courseSlug: "c1", instructionsText: "" })],
  });
  render(<AssignmentPage ov={ov} slug="c1" id="a1" go={() => {}} />);
  expect(screen.getByText(/No instructions were scraped/)).toBeInTheDocument();
});

test("the Start in Claude CopyButton carries a.helpCommand exactly", async () => {
  const writeText = stubClipboard();
  const ov = overview({
    assignments: [
      assignment({
        id: "a1",
        courseSlug: "c1",
        helpCommand: '/mesa:ares-brain-assignment-help "X" "Y"',
      }),
    ],
  });
  render(<AssignmentPage ov={ov} slug="c1" id="a1" go={() => {}} />);
  await act(async () => {
    screen.getByRole("button", { name: "Start in Claude" }).click();
    await Promise.resolve();
  });
  expect(writeText).toHaveBeenCalledWith('/mesa:ares-brain-assignment-help "X" "Y"');
});

test("re-rendering with a different id reloads that id's checklist (key={id} prevents stale state)", () => {
  localStorage.clear();
  localStorage.setItem("ares.checklist.a1", JSON.stringify([{ text: "A's step", done: false }]));
  localStorage.setItem("ares.checklist.b1", JSON.stringify([{ text: "B's step", done: false }]));
  const ov = overview({
    assignments: [
      assignment({ id: "a1", courseSlug: "c1", title: "Assignment A" }),
      assignment({ id: "b1", courseSlug: "c1", title: "Assignment B" }),
    ],
  });
  const { rerender } = render(<AssignmentPage ov={ov} slug="c1" id="a1" go={() => {}} />);
  expect(screen.getByText("A's step")).toBeInTheDocument();

  rerender(<AssignmentPage ov={ov} slug="c1" id="b1" go={() => {}} />);
  expect(screen.getByText("B's step")).toBeInTheDocument();
  expect(screen.queryByText("A's step")).not.toBeInTheDocument();
});

test("a slug/id pair matching no assignment renders the not-found state with a working back link", () => {
  const go = vi.fn();
  const ov = overview({ assignments: [] });
  render(<AssignmentPage ov={ov} slug="nope" id="nope" go={go} />);
  expect(screen.getByText(/not found/i)).toBeInTheDocument();
  screen.getByText(/all assignments/i).click();
  expect(go).toHaveBeenCalledWith("assignments");
});

test('the back button calls go("assignments")', () => {
  const go = vi.fn();
  const ov = overview({ assignments: [assignment({ id: "a1", courseSlug: "c1" })] });
  render(<AssignmentPage ov={ov} slug="c1" id="a1" go={go} />);
  screen.getByText(/all assignments/i).click();
  expect(go).toHaveBeenCalledWith("assignments");
});

test("Attached materials panel is hidden when materials is empty", () => {
  const ov = overview({
    assignments: [assignment({ id: "a1", courseSlug: "c1", materials: [] })],
  });
  render(<AssignmentPage ov={ov} slug="c1" id="a1" go={() => {}} />);
  expect(screen.queryByText("Attached materials")).not.toBeInTheDocument();
});

test("Attached materials panel shows a kind pill when materials is non-empty", () => {
  const ov = overview({
    assignments: [
      assignment({
        id: "a1",
        courseSlug: "c1",
        materials: [{ title: "Rubric", kind: "pdf" }],
      }),
    ],
  });
  render(<AssignmentPage ov={ov} slug="c1" id="a1" go={() => {}} />);
  expect(screen.getByText("Attached materials")).toBeInTheDocument();
  expect(screen.getByText("Rubric")).toBeInTheDocument();
  expect(screen.getByText("pdf")).toBeInTheDocument();
});

test("Maps to panel is hidden when sessionRef is null", () => {
  const ov = overview({
    assignments: [assignment({ id: "a1", courseSlug: "c1", sessionRef: null })],
  });
  render(<AssignmentPage ov={ov} slug="c1" id="a1" go={() => {}} />);
  expect(screen.queryByText("Maps to")).not.toBeInTheDocument();
});

test("Maps to panel shows the session and a secondary (non-cta) Brief-this-session button", () => {
  const ov = overview({
    assignments: [assignment({ id: "a1", courseSlug: "c1", sessionRef: 4, course: "Finance" })],
  });
  render(<AssignmentPage ov={ov} slug="c1" id="a1" go={() => {}} />);
  expect(screen.getByText(/Session 4/)).toBeInTheDocument();
  const briefBtn = screen.getByRole("button", { name: "Brief this session" });
  expect(briefBtn.className).not.toContain("bg-cta");
});

test("deadline panel shows hard cutoff only when cutoffAt is set", () => {
  const ov1 = overview({
    assignments: [
      assignment({ id: "a1", courseSlug: "c1", dueAt: "2026-09-10T10:00:00", cutoffAt: null }),
    ],
  });
  const { rerender } = render(<AssignmentPage ov={ov1} slug="c1" id="a1" go={() => {}} />);
  expect(screen.queryByText(/hard cutoff/)).not.toBeInTheDocument();

  const ov2 = overview({
    assignments: [
      assignment({
        id: "a1",
        courseSlug: "c1",
        dueAt: "2026-09-10T10:00:00",
        cutoffAt: "2026-09-11T10:00:00",
      }),
    ],
  });
  rerender(<AssignmentPage ov={ov2} slug="c1" id="a1" go={() => {}} />);
  expect(screen.getByText(/hard cutoff/)).toBeInTheDocument();
});

test("the late-submission line renders both ways", () => {
  const ovAllow = overview({
    assignments: [
      assignment({
        id: "a1",
        courseSlug: "c1",
        dueAt: "2026-09-10T10:00:00",
        allowLate: true,
      }),
    ],
  });
  const { rerender } = render(<AssignmentPage ov={ovAllow} slug="c1" id="a1" go={() => {}} />);
  expect(screen.getByText("late allowed")).toBeInTheDocument();

  const ovDeny = overview({
    assignments: [
      assignment({
        id: "a1",
        courseSlug: "c1",
        dueAt: "2026-09-10T10:00:00",
        allowLate: false,
      }),
    ],
  });
  rerender(<AssignmentPage ov={ovDeny} slug="c1" id="a1" go={() => {}} />);
  expect(screen.getByText("no late submissions")).toBeInTheDocument();
});

test("the three unmargined deadline lines (due/cutoff/late) share a space-y-2 wrapper", () => {
  const ov = overview({
    assignments: [
      assignment({
        id: "a1",
        courseSlug: "c1",
        dueAt: "2026-09-10T10:00:00",
        cutoffAt: "2026-09-11T10:00:00",
      }),
    ],
  });
  render(<AssignmentPage ov={ov} slug="c1" id="a1" go={() => {}} />);
  const dueLine = screen.getByText(/^due /);
  const wrapper = dueLine.parentElement;
  expect(wrapper).toHaveClass("space-y-2");
  const cutoffLine = screen.getByText(/hard cutoff/);
  const lateLine = screen.getByText("no late submissions");
  expect(cutoffLine.parentElement).toBe(wrapper);
  expect(lateLine.parentElement).toBe(wrapper);
});

test("every panel Card takes gap-0 so child margins don't double-count against the flex gap", () => {
  const ov = overview({ assignments: [assignment({ id: "a1", courseSlug: "c1" })] });
  const { container } = render(<AssignmentPage ov={ov} slug="c1" id="a1" go={() => {}} />);
  const cards = container.querySelectorAll('[data-slot="card"]');
  expect(cards.length).toBeGreaterThan(0);
  cards.forEach((card) => expect(card).toHaveClass("gap-0"));
});
