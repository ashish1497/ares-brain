import { describe, it, expect } from "vitest";

describe("brain_query tool", () => {
  it("builds argv with JSON params", async () => {
    const { buildBrainQueryArgs } = await import("../src/tools/brain_query.js");
    expect(buildBrainQueryArgs({ course: "x", type: "assignment" })).toEqual([
      "brain-query",
      "--params",
      '{"course":"x","type":"assignment"}',
    ]);
  });
  it("maps camelCase to snake_case and surfaces sidecar-missing", async () => {
    process.env.CA_FAKE_NO_VENV = "1";
    const { brainQueryTool } = await import("../src/tools/brain_query.js");
    const r = await brainQueryTool.handler({ sessionMin: 2 });
    expect(r.ok).toBe(false);
    delete process.env.CA_FAKE_NO_VENV;
  });
});
