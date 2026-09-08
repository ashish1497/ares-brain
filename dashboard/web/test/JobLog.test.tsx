import { render, screen } from "@testing-library/react";
import { JobLog } from "../src/components/JobLog";

test("shows lines and idle state", () => {
  const { rerender } = render(<JobLog job={null} lines={[]} />);
  expect(screen.getByText("No job running")).toBeInTheDocument();
  rerender(
    <JobLog
      job={{ id: "1", kind: "sync", status: "running", startedAt: "", log: [] }}
      lines={["a", "b"]}
    />,
  );
  expect(screen.getByText("running")).toBeInTheDocument();
  expect(screen.getByText("sync")).toBeInTheDocument();
  expect(screen.getByText("a\nb", { normalizer: (s: string) => s })).toBeInTheDocument();
});

test("has no middot between status and kind", () => {
  render(
    <JobLog job={{ id: "1", kind: "sync", status: "failed", startedAt: "", log: [] }} lines={[]} />,
  );
  expect(screen.queryByText(/·/)).not.toBeInTheDocument();
});
