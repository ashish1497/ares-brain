import { render, screen } from "@testing-library/preact";
import { JobLog } from "../src/components/JobLog";

test("shows lines and idle state", () => {
  const { rerender } = render(<JobLog job={null} lines={[]} />);
  expect(screen.getByText("No job running")).toBeDefined();
  rerender(
    <JobLog
      job={{ id: "1", kind: "sync", status: "running", startedAt: "", log: [] }}
      lines={["a", "b"]}
    />,
  );
  expect(screen.getByText(/a\nb/, { normalizer: (s) => s })).toBeDefined();
});
