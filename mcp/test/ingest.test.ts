import { describe, it, expect } from "vitest";

describe("ingest tool", () => {
  it("builds argv", async () => {
    const { buildIngestArgs } = await import("../src/tools/ingest.js");
    expect(buildIngestArgs({})).toEqual(["ingest"]);
    expect(buildIngestArgs({ course: "x" })).toEqual(["ingest", "--course", "x"]);
  });

  it("surfaces the sidecar-missing error", async () => {
    process.env.CA_FAKE_NO_VENV = "1";
    const { ingestTool } = await import("../src/tools/ingest.js");
    const r = await ingestTool.handler({});
    expect(r.ok).toBe(false);
    expect(String(r.error)).toContain("uv venv");
    delete process.env.CA_FAKE_NO_VENV;
  });
});
