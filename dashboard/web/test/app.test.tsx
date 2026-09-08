import { render, waitFor } from "@testing-library/preact";
import { beforeEach, expect, test, vi } from "vitest";
import * as api from "../src/api";
import type { State } from "../src/api";
import { App } from "../src/app";

vi.mock("../src/api");

const mockApi = api as unknown as Record<
  "getCourses" | "getState" | "streamLog" | "startJob",
  ReturnType<typeof vi.fn>
>;

const runningState = (): State => ({
  job: { id: "job-1", kind: "sync", status: "running", startedAt: "", log: [] },
  lastRuns: {},
});
const doneState = (): State => ({
  job: { id: "job-1", kind: "sync", status: "done", startedAt: "", log: [] },
  lastRuns: {},
});

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.getCourses.mockResolvedValue([{ slug: "x", name: "X" }]);
  mockApi.streamLog.mockReturnValue(() => {});
});

test("reattaches an SSE stream to a job already running on load", async () => {
  mockApi.getState.mockResolvedValue(runningState());
  render(<App />);
  await waitFor(() =>
    expect(mockApi.streamLog).toHaveBeenCalledWith(
      "job-1",
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
    ),
  );
});

test("busy clears (buttons re-enable) when the streamed job ends", async () => {
  mockApi.getState.mockResolvedValueOnce(runningState()).mockResolvedValue(doneState());
  let onEnd: (code: number) => void = () => {};
  mockApi.streamLog.mockImplementation((_id, _line, end) => {
    onEnd = end;
    return () => {};
  });
  const { getByText } = render(<App />);
  await waitFor(() => expect(getByText("Sync running…")).toBeDefined());

  onEnd(0);

  await waitFor(() => {
    const btn = getByText("Run sync") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });
});

test("refetches the course list when a job ends (first-run Sync populates it)", async () => {
  mockApi.getState.mockResolvedValue(runningState());
  mockApi.getCourses.mockResolvedValue([]);
  let onEnd: (code: number) => void = () => {};
  mockApi.streamLog.mockImplementation((_id, _line, end) => {
    onEnd = end;
    return () => {};
  });
  render(<App />);
  await waitFor(() => expect(mockApi.streamLog).toHaveBeenCalled());

  const before = mockApi.getCourses.mock.calls.length;
  mockApi.getCourses.mockResolvedValue([{ slug: "new-course", name: "New" }]);
  onEnd(0);

  await waitFor(() => expect(mockApi.getCourses.mock.calls.length).toBeGreaterThan(before));
});

test("stream error refetches state so the poll can recover", async () => {
  mockApi.getState.mockResolvedValue(runningState());
  let onError: () => void = () => {};
  mockApi.streamLog.mockImplementation((_id, _line, _end, err) => {
    onError = err;
    return () => {};
  });
  render(<App />);
  await waitFor(() => expect(mockApi.streamLog).toHaveBeenCalled());

  const before = mockApi.getState.mock.calls.length;
  onError();

  await waitFor(() => expect(mockApi.getState.mock.calls.length).toBeGreaterThan(before));
});
