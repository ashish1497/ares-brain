import { describe, it, expect } from "vitest";

describe("transcribe tool", () => {
  it("builds argv", async () => {
    const { buildTranscribeArgs } = await import("../src/tools/transcribe.js");
    expect(buildTranscribeArgs({})).toEqual(["transcribe"]);
    expect(buildTranscribeArgs({ course: "x" })).toEqual(["transcribe", "--course", "x"]);
  });

  it("surfaces the sidecar-missing error", async () => {
    process.env.CA_FAKE_NO_VENV = "1";
    const { transcribeTool } = await import("../src/tools/transcribe.js");
    const r = await transcribeTool.handler({});
    expect(r.ok).toBe(false);
    expect(String(r.error)).toContain("uv venv");
    delete process.env.CA_FAKE_NO_VENV;
  });
});
