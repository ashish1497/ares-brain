import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import { TodaysBrief } from "../src/components/today/TodaysBrief";
import * as api from "../src/api";

function mockBrief(brief: { date: string; morning: string | null; evening: string | null }) {
  vi.spyOn(api, "getDailyBrief").mockResolvedValue(brief);
}

afterEach(() => vi.restoreAllMocks());

test("renders nothing while neither morning nor evening exists", async () => {
  mockBrief({ date: "2026-09-12", morning: null, evening: null });
  const { container } = render(<TodaysBrief />);
  await waitFor(() => expect(api.getDailyBrief).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});

test("renders nothing when the fetch itself fails", async () => {
  vi.spyOn(api, "getDailyBrief").mockRejectedValue(new Error("network"));
  const { container } = render(<TodaysBrief />);
  await waitFor(() => expect(api.getDailyBrief).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});

test("renders the morning brief's headings, bold, and list items", async () => {
  mockBrief({
    date: "2026-09-12",
    morning:
      "# 2026-09-12 — morning brief\n\n## Missed\n_(nothing overdue)_\n\n## Today's classes\n- **09:30–11:00** Business Frameworks\n",
    evening: null,
  });
  render(<TodaysBrief />);
  expect(await screen.findByText("Today's brief")).toBeInTheDocument();
  expect(screen.getByText("Missed")).toBeInTheDocument();
  expect(screen.getByText("(nothing overdue)")).toBeInTheDocument();
  expect(screen.getByText("09:30–11:00", { exact: false })).toBeInTheDocument();
});

test("shows a Morning/Evening toggle only when both exist, defaulting to evening", async () => {
  mockBrief({
    date: "2026-09-12",
    morning: "## Today's classes\n_no classes today_\n",
    evening: "## Tomorrow\n_no classes tomorrow_\n",
  });
  render(<TodaysBrief />);
  expect(await screen.findByText("Tomorrow")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Morning" })).toBeInTheDocument();
  const eveningBtn = screen.getByRole("button", { name: "Evening" });
  expect(eveningBtn).toBeInTheDocument();

  fireEvent.click(eveningBtn);
  expect(screen.getByText("Tomorrow")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Morning" }));
  expect(await screen.findByText("Today's classes")).toBeInTheDocument();
});

test("no toggle when only one of morning/evening exists", async () => {
  mockBrief({
    date: "2026-09-12",
    morning: "## Today's classes\n_no classes today_\n",
    evening: null,
  });
  render(<TodaysBrief />);
  await screen.findByText("Today's classes");
  expect(screen.queryByRole("button", { name: "Morning" })).not.toBeInTheDocument();
});

test("italicises a nested empty-state marker under a list item, not literal underscores", async () => {
  mockBrief({
    date: "2026-09-12",
    morning: "## Tomorrow\n- **09:30–20:00** Build Your Own Business\n  - _no pre-reads found_\n",
    evening: null,
  });
  render(<TodaysBrief />);
  expect(await screen.findByText("no pre-reads found")).toBeInTheDocument();
  expect(screen.queryByText(/_no pre-reads found_/)).not.toBeInTheDocument();
});

test("italicises a partial-line marker followed by plain text, not just a whole line", async () => {
  mockBrief({
    date: "2026-09-12",
    morning:
      "## Today's classes\n- **11:30–13:00** The Art of Selling\n  - _no pre-reads found_ (posted this morning)\n",
    evening: null,
  });
  render(<TodaysBrief />);
  expect(await screen.findByText(/no pre-reads found/)).toBeInTheDocument();
  expect(await screen.findByText(/posted this morning/)).toBeInTheDocument();
  expect(screen.queryByText(/_no pre-reads found_/)).not.toBeInTheDocument();
});

test("an underscore inside inline code is not mistaken for an italic marker", async () => {
  mockBrief({
    date: "2026-09-12",
    morning:
      "> run `cd scraper && uv run python lms_scrape.py calendar-auth` (needs `client_secret.json`)\n\n## Today's classes\n_no classes today_\n",
    evening: null,
  });
  render(<TodaysBrief />);
  expect(
    await screen.findByText("cd scraper && uv run python lms_scrape.py calendar-auth"),
  ).toBeInTheDocument();
  expect(screen.getByText("client_secret.json")).toBeInTheDocument();
});

test("renders a banner for a > blockquote line", async () => {
  mockBrief({
    date: "2026-09-12",
    morning: "> ⚠️ Calendar not synced\n\n## Today's classes\n_no classes today_\n",
    evening: null,
  });
  render(<TodaysBrief />);
  expect(await screen.findByText(/Calendar not synced/)).toBeInTheDocument();
});
