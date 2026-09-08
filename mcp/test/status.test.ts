import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("status tool", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "ca-"));
    process.env.ARES_BRAIN_HOME = home;
    mkdirSync(join(home, "courses", "business-frameworks", "raw"), { recursive: true });
    writeFileSync(join(home, "courses", "business-frameworks", "raw", "topics.json"), "[]");
    writeFileSync(
      join(home, "courses", "_meta.json"),
      JSON.stringify({ scrapedAt: "2026-09-01T06:00:00Z" }),
    );
    mkdirSync(join(home, "courses", "business-frameworks", "normalized"), { recursive: true });
    writeFileSync(
      join(home, "courses", "business-frameworks", "normalized", "_ingest.json"),
      JSON.stringify({ sources: {}, ingestedAt: "2026-09-02T07:00:00Z" }),
    );
    // a second course ingested earlier — lastIngest() must return the most recent across courses
    mkdirSync(join(home, "courses", "power-of-communication", "normalized"), { recursive: true });
    writeFileSync(
      join(home, "courses", "power-of-communication", "normalized", "_ingest.json"),
      JSON.stringify({ sources: {}, ingestedAt: "2026-09-01T09:00:00Z" }),
    );
    mkdirSync(join(home, "courses", "business-frameworks", "brain"), { recursive: true });
    writeFileSync(
      join(home, "courses", "business-frameworks", "brain", "_brain.json"),
      JSON.stringify({ indexBuiltAt: "2026-09-02T08:00:00Z", guideBuiltAt: null }),
    );
  });

  it("reports home, courses, and token expiry", async () => {
    delete process.env.MESA_REFRESH_TOKEN;
    // a refresh token with exp = 1790837879, written to <home>/.env like prod
    writeFileSync(
      join(home, ".env"),
      "MESA_REFRESH_TOKEN=eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOiJ4Iiwic3ViIjoieSIsImlhdCI6MTc4ODI0NTg3OSwiZXhwIjoxNzkwODM3ODc5fQ.sig\n",
    );
    const { statusTool } = await import("../src/tools/status.js");
    const r = await statusTool.handler();
    expect(r.home).toBe(home);
    expect(r.configLoaded).toBe(true);
    expect(r.tokenPresent).toBe(true);
    expect(r.tokenExpiresAt).toBe("2026-10-01T06:57:59.000Z"); // new Date(1790837879 * 1000).toISOString()
    expect(r.courses.find((c) => c.slug === "business-frameworks")?.counts.raw).toBe(1);
    expect(r.lastScrape).toBe("2026-09-01T06:00:00Z");
    expect(r.lastIngest).toBe("2026-09-02T07:00:00Z");
    expect(r.brains.find((b) => b.slug === "business-frameworks")?.indexBuiltAt).toBe(
      "2026-09-02T08:00:00Z",
    );
  });
});
