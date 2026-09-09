import { fireEvent, render, screen } from "@testing-library/react";
import { BrainTab } from "../src/components/BrainTab";
import { brain, overview } from "./factories";
import type { TabProps } from "../src/lib/types";

const baseProps = (over: Partial<TabProps["ov"]> = {}, onJob = vi.fn()): TabProps => ({
  ov: overview(over),
  onJob,
  busy: false,
  go: () => {},
  params: [],
});

test("sort order is not-built -> stale -> ready", () => {
  render(
    <BrainTab
      {...baseProps({
        brain: [
          brain({ course: "Ready One", courseSlug: "r1", state: "ready" }),
          brain({ course: "Not Built One", courseSlug: "n1", state: "not-built" }),
          brain({ course: "Stale One", courseSlug: "s1", state: "stale" }),
        ],
        chatUnlockAt: 3,
      })}
    />,
  );
  const rows = screen.getAllByRole("row").slice(1);
  expect(rows[0].textContent).toContain("Not Built One");
  expect(rows[1].textContent).toContain("Stale One");
  expect(rows[2].textContent).toContain("Ready One");
});

test("the Ingest button is absent for ready rows", () => {
  render(
    <BrainTab
      {...baseProps({
        brain: [brain({ course: "Ready One", courseSlug: "r1", state: "ready" })],
      })}
    />,
  );
  expect(screen.queryByRole("button", { name: /Ingest/ })).not.toBeInTheDocument();
});

test("clicking Ingest calls onJob('ingest', { course })", () => {
  const onJob = vi.fn();
  render(
    <BrainTab
      {...baseProps(
        { brain: [brain({ course: "Not Built", courseSlug: "nb1", state: "not-built" })] },
        onJob,
      )}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Ingest/ }));
  expect(onJob).toHaveBeenCalledWith("ingest", { course: "nb1" });
});

test("busy disables the Ingest button", () => {
  render(
    <BrainTab
      {...baseProps({
        brain: [brain({ course: "Not Built", courseSlug: "nb1", state: "not-built" })],
      })}
      busy={true}
    />,
  );
  expect(screen.getByRole("button", { name: /Ingest/ })).toBeDisabled();
});

test("corpus renders — when corpusBytes is null", () => {
  render(
    <BrainTab
      {...baseProps({
        brain: [brain({ course: "No Corpus", courseSlug: "nc1", corpusBytes: null })],
      })}
    />,
  );
  expect(screen.getByText("—")).toBeInTheDocument();
});

test("corpus renders — when corpusBytes is 0", () => {
  render(
    <BrainTab
      {...baseProps({
        brain: [brain({ course: "Zero Corpus", courseSlug: "zc1", corpusBytes: 0 })],
      })}
    />,
  );
  expect(screen.getByText("—")).toBeInTheDocument();
});

test("corpus renders <1 KB for a sub-1024-byte corpus", () => {
  render(
    <BrainTab
      {...baseProps({
        brain: [brain({ course: "Tiny Corpus", courseSlug: "tc1", corpusBytes: 500 })],
      })}
    />,
  );
  expect(screen.getByText("<1 KB")).toBeInTheDocument();
});

test("corpus renders rounded KB when corpusBytes is set", () => {
  render(
    <BrainTab
      {...baseProps({
        brain: [brain({ course: "Has Corpus", courseSlug: "hc1", corpusBytes: 2048 })],
      })}
    />,
  );
  expect(screen.getByText("2 KB")).toBeInTheDocument();
});

test("progress value is right and does not blow up when chatUnlockAt is 0", () => {
  render(
    <BrainTab
      {...baseProps({
        brain: [brain({ course: "C", courseSlug: "c" })],
        kpis: {
          dueThisWeek: 0,
          nextExamInDays: null,
          nextExamName: null,
          cpAvg: null,
          attendanceNow: 0,
          attendanceBestCase: 0,
          brainReady: 0,
          courseCount: 1,
        },
        chatUnlockAt: 0,
      })}
    />,
  );
  const bar = screen.getByRole("progressbar");
  expect(bar.getAttribute("aria-valuenow")).not.toBe("Infinity");
  expect(bar.getAttribute("aria-valuenow")).not.toBe("NaN");
  expect(Number(bar.getAttribute("aria-valuenow"))).toBe(0);
});

test("a reason with a middot renders as MetaRow parts with no middot in the output", () => {
  const { container } = render(
    <BrainTab
      {...baseProps({
        brain: [
          brain({
            course: "C",
            courseSlug: "c",
            reason: "6 recordings to transcribe · guide 1 sources behind",
          }),
        ],
      })}
    />,
  );
  expect(screen.getByText("6 recordings to transcribe")).toBeInTheDocument();
  expect(screen.getByText("guide 1 sources behind")).toBeInTheDocument();
  expect(container.textContent).not.toContain("·");
});

test("a reason with no middot renders unchanged as a single item", () => {
  render(
    <BrainTab
      {...baseProps({
        brain: [brain({ course: "C", courseSlug: "c", reason: "up to date" })],
      })}
    />,
  );
  expect(screen.getByText("up to date")).toBeInTheDocument();
});

test("the State column header carries an InfoTip with the exact copy", () => {
  render(<BrainTab {...baseProps({ brain: [brain({ course: "C", courseSlug: "c" })] })} />);
  const stateHeader = screen.getByRole("columnheader", { name: /^State/ });
  const btn = stateHeader.querySelector("button")!;
  fireEvent.click(btn);
  expect(screen.getByRole("tooltip").textContent).toBe(
    "ready = the guide is built and current. stale = a guide exists but new material has landed since. not-built = no guide yet.",
  );
});

test("the progress-bar header carries an InfoTip interpolating chatUnlockAt", () => {
  render(
    <BrainTab
      {...baseProps({
        brain: [brain({ course: "C", courseSlug: "c" })],
        chatUnlockAt: 5,
      })}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "about the brain progress bar" }));
  expect(screen.getByRole("tooltip").textContent).toBe(
    "Course brains built, against the 5 needed to unlock chat.",
  );
});

test("header reads N of M course brains ready and chat unlock threshold", () => {
  render(
    <BrainTab
      {...baseProps({
        brain: [
          brain({ course: "A", courseSlug: "a", state: "ready" }),
          brain({ course: "B", courseSlug: "b", state: "not-built" }),
        ],
        kpis: {
          dueThisWeek: 0,
          nextExamInDays: null,
          nextExamName: null,
          cpAvg: null,
          attendanceNow: 0,
          attendanceBestCase: 0,
          brainReady: 1,
          courseCount: 2,
        },
        chatUnlockAt: 3,
      })}
    />,
  );
  expect(screen.getByText(/1 of 2 course brains ready/)).toBeInTheDocument();
  expect(screen.getByText(/chat unlocks at 3/)).toBeInTheDocument();
});
