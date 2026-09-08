import { describe, it, expect } from "vitest";
import { extOk, safeName } from "../src/lib/upload.js";

describe("upload helpers", () => {
  it("book accepts pdf/docx only", () => {
    expect(extOk("book", "a.pdf")).toBe(true);
    expect(extOk("book", "a.PDF")).toBe(true);
    expect(extOk("book", "a.mp3")).toBe(false);
  });
  it("recording accepts audio/video", () => {
    expect(extOk("recording", "c.m4a")).toBe(true);
    expect(extOk("recording", "c.txt")).toBe(false);
  });
  it("safeName strips path + weird chars", () => {
    expect(safeName("../../etc/pa ss.pdf")).toBe("pa_ss.pdf");
    expect(safeName("nice-file.pdf")).toBe("nice-file.pdf");
  });
});
