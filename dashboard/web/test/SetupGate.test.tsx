import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { SetupGate } from "../src/components/SetupGate";

describe("SetupGate", () => {
  it("renders the checklist, not children, while not ready", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        driveConnected: false,
        calendarConnected: true,
        mesaTokenPresent: true,
        claudeCliLoggedIn: true,
        ready: false,
      }),
    }) as any;
    render(
      <SetupGate>
        <div>real app</div>
      </SetupGate>,
    );
    expect(await screen.findByText(/Drive/)).toBeInTheDocument();
    expect(screen.queryByText("real app")).not.toBeInTheDocument();
  });

  it("renders children once ready", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        driveConnected: true,
        calendarConnected: true,
        mesaTokenPresent: true,
        claudeCliLoggedIn: true,
        ready: true,
      }),
    }) as any;
    render(
      <SetupGate>
        <div>real app</div>
      </SetupGate>,
    );
    expect(await screen.findByText("real app")).toBeInTheDocument();
  });
});
