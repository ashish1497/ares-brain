import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let home: string;
const savedHome = process.env.ARES_BRAIN_HOME;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "ares-brain-dailybrief-"));
  await mkdir(join(home, "daily"), { recursive: true });
  process.env.ARES_BRAIN_HOME = home;
});

afterEach(async () => {
  if (savedHome === undefined) delete process.env.ARES_BRAIN_HOME;
  else process.env.ARES_BRAIN_HOME = savedHome;
  await rm(home, { recursive: true, force: true });
});

describe("readDailyBrief", () => {
  it("defaults to today (local) and returns null for missing files", async () => {
    const { readDailyBrief } = await import("../src/lib/dailyBrief.js");
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, "0");
    const d = String(today.getDate()).padStart(2, "0");
    const expectedDate = `${y}-${m}-${d}`;
    const r = await readDailyBrief();
    expect(r.date).toBe(expectedDate);
    expect(r.morning).toBeNull();
    expect(r.evening).toBeNull();
  });

  it("reads both files for a given date when present", async () => {
    const { readDailyBrief } = await import("../src/lib/dailyBrief.js");
    await writeFile(join(home, "daily", "2026-09-12.md"), "# morning brief");
    await writeFile(join(home, "daily", "2026-09-12-evening.md"), "# evening check");
    const r = await readDailyBrief("2026-09-12");
    expect(r.morning).toBe("# morning brief");
    expect(r.evening).toBe("# evening check");
  });

  it("returns evening null when only morning exists", async () => {
    const { readDailyBrief } = await import("../src/lib/dailyBrief.js");
    await writeFile(join(home, "daily", "2026-09-13.md"), "# morning only");
    const r = await readDailyBrief("2026-09-13");
    expect(r.morning).toBe("# morning only");
    expect(r.evening).toBeNull();
  });

  it("rejects a malformed date and falls back to today", async () => {
    const { readDailyBrief } = await import("../src/lib/dailyBrief.js");
    const r = await readDailyBrief("not-a-date");
    expect(r.date).not.toBe("not-a-date");
  });
});
