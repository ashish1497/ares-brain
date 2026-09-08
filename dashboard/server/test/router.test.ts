import { describe, it, expect } from "vitest";
import { match } from "../src/lib/router.js";

describe("router match", () => {
  it("matches a literal path", () => {
    expect(match("GET", "/api/courses", "GET", "/api/courses")).toEqual({});
  });
  it("captures :params", () => {
    expect(match("GET", "/api/jobs/:id/log", "GET", "/api/jobs/abc123/log")).toEqual({
      id: "abc123",
    });
  });
  it("rejects a method mismatch", () => {
    expect(match("POST", "/api/jobs", "GET", "/api/jobs")).toBeNull();
  });
  it("rejects a length mismatch", () => {
    expect(match("GET", "/api/jobs/:id", "GET", "/api/jobs/a/b")).toBeNull();
  });
});
