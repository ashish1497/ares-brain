import { describe, it, expect } from "vitest";

describe("brain_next_session tool", () => {
  it("builds argv with the required course", async () => {
    const { buildBrainNextSessionArgs } = await import("../src/tools/brain_next_session.js");
    expect(buildBrainNextSessionArgs("course-one")).toEqual([
      "next-session",
      "--course",
      "course-one",
    ]);
  });

  it("rejects a missing course slug", async () => {
    const { brainNextSessionTool } = await import("../src/tools/brain_next_session.js");
    const r = await brainNextSessionTool.handler({});
    expect(r).toEqual({ ok: false, error: "course slug required" });
  });

  it("surfaces sidecar-missing", async () => {
    process.env.CA_FAKE_NO_VENV = "1";
    const { brainNextSessionTool } = await import("../src/tools/brain_next_session.js");
    const r = await brainNextSessionTool.handler({ course: "course-one" });
    expect(r.ok).toBe(false);
    delete process.env.CA_FAKE_NO_VENV;
  });
});
