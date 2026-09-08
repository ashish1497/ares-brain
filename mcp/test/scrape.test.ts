import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("scrape tool", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "ca-"));
    process.env.COURSE_AGENT_HOME = home;
  });

  it("reports a helpful error when the venv is missing", async () => {
    process.env.CA_FAKE_NO_VENV = "1";
    const { scrapeTool } = await import("../src/tools/scrape.js");
    const r = await scrapeTool.handler({});
    expect(r.ok).toBe(false);
    expect(String(r.error)).toContain("uv venv");
    delete process.env.CA_FAKE_NO_VENV;
  });

  it("builds argv from tool args (passthrough)", async () => {
    const { buildArgs } = await import("../src/tools/scrape.js");
    expect(buildArgs({})).toEqual(["all"]);
    expect(buildArgs({ course: "x", force: true })).toEqual(["all", "--course", "x", "--force"]);
    expect(buildArgs({ course: "x" })).toEqual(["all", "--course", "x"]);
  });

  it("parses the trailing JSON summary line from the sidecar", async () => {
    const { parseSummaryLine } = await import("../src/lib/python.js");
    const stdout = '  business-frameworks: ok\n{"term":"Term 1","courses":16,"errors":[]}\n';
    expect(parseSummaryLine(stdout)).toEqual({
      term: "Term 1",
      courses: 16,
      errors: [],
    });
  });
});
