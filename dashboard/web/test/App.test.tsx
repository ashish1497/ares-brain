import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import * as api from "../src/api";
import { App } from "../src/App";
import { overview } from "./factories";

vi.mock("../src/api", async (orig) => ({
  ...(await orig<typeof import("../src/api")>()),
  getOverview: vi.fn(),
  getState: vi.fn(),
  startJob: vi.fn(),
  streamLog: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(api.getState).mockResolvedValue({ job: null, lastRuns: {} });
});

test("a failed /api/overview renders an error card with a Retry button, not a stuck loading state", async () => {
  vi.mocked(api.getOverview).mockRejectedValue(new Error("overview 503"));

  render(<App />);

  expect(await screen.findByText("couldn't load overview")).toBeInTheDocument();
  expect(screen.getByText("overview 503")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  expect(screen.queryByText("loading…")).not.toBeInTheDocument();
});

test("Retry re-runs the fetch and renders the sections on success", async () => {
  vi.mocked(api.getOverview).mockRejectedValueOnce(new Error("overview 503"));
  vi.mocked(api.getOverview).mockResolvedValue(overview());

  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Retry" }));

  expect(await screen.findByText("Needs your input")).toBeInTheDocument();
  expect(screen.queryByText("couldn't load overview")).not.toBeInTheDocument();
});

test("a successful load renders the dashboard sections", async () => {
  vi.mocked(api.getOverview).mockResolvedValue(overview());

  render(<App />);

  expect(await screen.findByText("ARES BRAIN")).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText("loading…")).not.toBeInTheDocument());
});
