import { fireEvent, render, screen } from "@testing-library/react";
import { GradePicture } from "../src/components/assignments/GradePicture";
import type { OverviewGradePicture } from "../src/api";

const row = (over: Partial<OverviewGradePicture> = {}): OverviewGradePicture => ({
  course: "Course",
  courseSlug: "course",
  components: [],
  aheadPct: 30,
  summary: "on track",
  ...over,
});

test("the bar's fill width matches 100 - aheadPct", () => {
  const { container } = render(<GradePicture rows={[row({ aheadPct: 30 })]} />);
  const fill = container.querySelector('[role="progressbar"] > div') as HTMLElement;
  expect(fill.style.width).toBe("70%");
});

test("a different aheadPct still matches 100 - aheadPct", () => {
  const { container } = render(<GradePicture rows={[row({ aheadPct: 5 })]} />);
  const fill = container.querySelector('[role="progressbar"] > div') as HTMLElement;
  expect(fill.style.width).toBe("95%");
});

test("the summary line renders", () => {
  render(<GradePicture rows={[row({ summary: "on track for an A", course: "Finance" })]} />);
  expect(screen.getByText("on track for an A")).toBeInTheDocument();
  expect(screen.getByText("Finance")).toBeInTheDocument();
});

test("the Grade picture heading carries an InfoTip explaining filled vs hollow", () => {
  render(<GradePicture rows={[row()]} />);
  fireEvent.click(screen.getByRole("button", { name: "about Grade picture" }));
  expect(screen.getByRole("tooltip").textContent).toBe(
    "Filled = the share of your final grade already assessed. Hollow = the share still ahead of you.",
  );
});
