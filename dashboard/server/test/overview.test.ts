import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "../src/index.js";
import type { Server } from "node:http";

let server: Server;
let base: string;
beforeAll(async () => {
  server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as any).port;
  base = `http://127.0.0.1:${port}`;
  // guardOrigin now runs on GET /api/overview — teach it our ephemeral port so a
  // same-origin fetch is accepted.
  process.env.ARES_BRAIN_DASHBOARD_PORT = String(port);
});
afterAll(() => {
  delete process.env.ARES_BRAIN_DASHBOARD_PORT;
  return new Promise<void>((r) => server.close(() => r()));
});

describe("GET /api/overview", () => {
  it("returns 200 + the overview shape (real sidecar against the test home)", async () => {
    const res = await fetch(`${base}/api/overview`);
    // 200 with data, or 503 if the venv/corpus isn't present in CI — accept both,
    // but if 200 the shape must be right
    if (res.status === 200) {
      const j = await res.json();
      expect(j).toHaveProperty("kpis");
      expect(j).toHaveProperty("attendance");
      expect(j).toHaveProperty("gaps");
    } else {
      expect(res.status).toBe(503);
    }
  });
});
