import { describe, it, expect } from "vitest";

describe("brain_status tool", () => {
  it("builds argv, with and without --course", async () => {
    const { buildBrainStatusArgs } = await import("../src/tools/brain_status.js");
    expect(buildBrainStatusArgs()).toEqual(["brain-status"]);
    expect(buildBrainStatusArgs("x")).toEqual(["brain-status", "--course", "x"]);
  });
  it("surfaces sidecar-missing", async () => {
    process.env.CA_FAKE_NO_VENV = "1";
    const { brainStatusTool } = await import("../src/tools/brain_status.js");
    const r = await brainStatusTool.handler({ course: "x" });
    expect(r.ok).toBe(false);
    delete process.env.CA_FAKE_NO_VENV;
  });
});
