import { describe, it, expect } from "vitest";

describe("calendar_sync tool", () => {
  it("builds argv with dryRun toggle", async () => {
    const { buildCalendarSyncArgs } = await import("../src/tools/calendar_sync.js");
    expect(buildCalendarSyncArgs({})).toEqual(["calendar-sync"]);
    expect(buildCalendarSyncArgs({ dryRun: true })).toEqual(["calendar-sync", "--dry-run"]);
  });
  it("surfaces sidecar-missing", async () => {
    process.env.CA_FAKE_NO_VENV = "1";
    const { calendarSyncTool } = await import("../src/tools/calendar_sync.js");
    const r = await calendarSyncTool.handler({});
    expect(r.ok).toBe(false);
    delete process.env.CA_FAKE_NO_VENV;
  });
});
