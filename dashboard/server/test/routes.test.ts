import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("../src/lib/jobs.js", async (orig) => {
  const actual = await orig<typeof import("../src/lib/jobs.js")>();
  return { ...actual };
});

import { createServer } from "../src/index.js";
import type { Server } from "node:http";

let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const a = server.address() as any;
  base = `http://127.0.0.1:${a.port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("routes", () => {
  it("GET /api/courses returns an array", async () => {
    const res = await fetch(`${base}/api/courses`);
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  it("GET /api/state has job + lastRuns keys", async () => {
    const j = await (await fetch(`${base}/api/state`)).json();
    expect(j).toHaveProperty("job");
    expect(j).toHaveProperty("lastRuns");
  });

  it("POST /api/jobs with a bogus kind -> 400", async () => {
    const res = await fetch(`${base}/api/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "nope" }),
    });
    expect(res.status).toBe(400);
  });

  it("unknown path -> 404 (api) ", async () => {
    expect((await fetch(`${base}/api/nope`)).status).toBe(404);
  });
});
