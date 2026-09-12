import { describe, it, expect } from "vitest";

describe("daily_brief tool", () => {
  it("builds argv (no --json — runScraper adds it)", async () => {
    const { buildDailyBriefArgs } = await import("../src/tools/daily_brief.js");
    expect(buildDailyBriefArgs({})).toEqual(["daily-brief"]);
  });
  it("passes numeric overrides", async () => {
    const { buildDailyBriefArgs } = await import("../src/tools/daily_brief.js");
    expect(buildDailyBriefArgs({ withinHours: 48, changedSinceHours: 12 })).toEqual([
      "daily-brief",
      "--within-hours",
      "48",
      "--changed-since-hours",
      "12",
    ]);
  });
  it("passes includeTomorrow", async () => {
    const { buildDailyBriefArgs } = await import("../src/tools/daily_brief.js");
    expect(buildDailyBriefArgs({ includeTomorrow: true })).toEqual([
      "daily-brief",
      "--include-tomorrow",
    ]);
  });
  it("surfaces sidecar-missing", async () => {
    process.env.CA_FAKE_NO_VENV = "1";
    const { dailyBriefTool } = await import("../src/tools/daily_brief.js");
    const r = await dailyBriefTool.handler({});
    expect(r.ok).toBe(false);
    delete process.env.CA_FAKE_NO_VENV;
  });
});
