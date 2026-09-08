import { describe, it, expect } from "vitest";

describe("brain_get tool", () => {
  it("builds argv", async () => {
    const { buildBrainGetArgs } = await import("../src/tools/brain_get.js");
    expect(buildBrainGetArgs({ course: "c1", path: "x.md" })).toEqual([
      "brain-get",
      "--course",
      "c1",
      "--path",
      "x.md",
    ]);
  });
  it("appends --max-bytes only when provided", async () => {
    const { buildBrainGetArgs } = await import("../src/tools/brain_get.js");
    expect(buildBrainGetArgs({ course: "c1", path: "x.md", maxBytes: 5000 })).toEqual([
      "brain-get",
      "--course",
      "c1",
      "--path",
      "x.md",
      "--max-bytes",
      "5000",
    ]);
  });
  it("rejects missing args", async () => {
    const { brainGetTool } = await import("../src/tools/brain_get.js");
    const r = await brainGetTool.handler({ course: "c1" });
    expect(r.ok).toBe(false);
  });
  it("surfaces sidecar-missing", async () => {
    process.env.CA_FAKE_NO_VENV = "1";
    const { brainGetTool } = await import("../src/tools/brain_get.js");
    const r = await brainGetTool.handler({ course: "c1", path: "x.md" });
    expect(r.ok).toBe(false);
    delete process.env.CA_FAKE_NO_VENV;
  });
});
