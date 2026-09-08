import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import * as api from "../src/api";
import { App } from "../src/App";
import { overview, todayClass } from "./factories";

/** Today tab now renders real content, not a placeholder — give it one class so its
 * `SectionHeader` heading ("Today") reliably renders instead of the EmptyToday panel. */
const overviewWithToday = () =>
  overview({ today: { classes: [todayClass()], dueTodayOrTomorrow: [], changed: [] } });

vi.mock("../src/api", async (orig) => ({
  ...(await orig<typeof import("../src/api")>()),
  getOverview: vi.fn(),
  getState: vi.fn(),
  startJob: vi.fn(),
  streamLog: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(api.getState).mockResolvedValue({ job: null, lastRuns: {} });
  window.location.hash = "";
});

test("a failed first load renders a full-page error card with a Retry button, not a stuck loading state", async () => {
  vi.mocked(api.getOverview).mockRejectedValue(new Error("overview 503"));

  render(<App />);

  expect(await screen.findByText("couldn't load overview")).toBeInTheDocument();
  expect(screen.getByText("overview 503")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  expect(screen.queryByText("loading…")).not.toBeInTheDocument();
});

test("Retry re-runs the fetch and renders the shell on success", async () => {
  vi.mocked(api.getOverview).mockRejectedValueOnce(new Error("overview 503"));
  vi.mocked(api.getOverview).mockResolvedValue(overview());

  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Retry" }));

  expect(await screen.findByText("ARES BRAIN")).toBeInTheDocument();
  expect(screen.queryByText("couldn't load overview")).not.toBeInTheDocument();
});

test("the default route (#today) renders the Today tab", async () => {
  vi.mocked(api.getOverview).mockResolvedValue(overviewWithToday());

  render(<App />);

  expect(await screen.findByRole("heading", { name: "Today" })).toBeInTheDocument();
});

test("an unknown hash falls back to the Today body instead of rendering blank", async () => {
  vi.mocked(api.getOverview).mockResolvedValue(overviewWithToday());
  window.location.hash = "#foo";

  render(<App />);

  expect(await screen.findByRole("heading", { name: "Today" })).toBeInTheDocument();
});

test("switching the hash renders another tab", async () => {
  vi.mocked(api.getOverview).mockResolvedValue(overviewWithToday());

  render(<App />);
  await screen.findByRole("heading", { name: "Today" });

  fireEvent.click(screen.getByRole("button", { name: "Exams" }));

  expect(await screen.findByRole("heading", { name: "Exams" })).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.queryByRole("heading", { name: "Today" })).not.toBeInTheDocument(),
  );
});

test("a later refresh failing after a good load shows a non-blocking stale banner, not the full-page error", async () => {
  vi.mocked(api.getOverview).mockResolvedValueOnce(overview());
  vi.mocked(api.getOverview).mockRejectedValueOnce(new Error("overview 503"));
  vi.mocked(api.startJob).mockResolvedValue({ jobId: "job-1" });
  vi.mocked(api.streamLog).mockImplementation((_jobId, _onLine, onEnd) => {
    onEnd(0);
    return () => {};
  });

  render(<App />);
  await screen.findByText("ARES BRAIN");

  fireEvent.click(screen.getByRole("button", { name: "⟲ Re-sync" }));

  expect(await screen.findByText(/showing stale data/)).toBeInTheDocument();
  expect(screen.queryByText("couldn't load overview")).not.toBeInTheDocument();
  expect(screen.getByText("ARES BRAIN")).toBeInTheDocument();
});
