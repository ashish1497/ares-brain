import { render, screen } from "@testing-library/preact";
import { SyncCard } from "../src/components/SyncCard";

test("button disabled while a job runs", () => {
  render(
    <SyncCard
      job={{ id: "1", kind: "sync", status: "running", startedAt: "", log: [] }}
      busy={true}
      onRun={() => {}}
    />,
  );
  expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
});
