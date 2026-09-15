import { describe, it, expect, beforeEach, vi } from "vitest";

// Every /api/* route now sits behind the onboarding gate (see setupGate.test.ts),
// which calls these for its own setup-state probe — report setup complete so the
// outreach routes under test here reach their real handlers.
vi.mock("../src/lib/python.js", async () => {
  const actual =
    await vi.importActual<typeof import("../src/lib/python.js")>("../src/lib/python.js");
  return {
    ...actual,
    runPythonJSON: vi.fn(() =>
      Promise.resolve({
        ok: true,
        data: { driveConnected: true, calendarConnected: true, mesaTokenPresent: true },
      }),
    ),
  };
});
vi.mock("../src/lib/claudeProbe.js", () => ({
  probeClaudeCli: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("../src/lib/outreach.js", async () => {
  const actual =
    await vi.importActual<typeof import("../src/lib/outreach.js")>("../src/lib/outreach.js");
  return {
    ...actual,
    runIcp: vi.fn(async () => ({ icp_summary: "fake icp", candidates: [], _sources: [] })),
    runIndustry: vi.fn(async () => ({ industry: "fake", _sources: [] })),
    runCompany: vi.fn(async () => ({ account_name: "fake co", _sources: [] })),
    runPeople: vi.fn(async () => ({ personas: [], people: [], _sources: [] })),
    runOutreach: vi.fn(async () => ({ per_person: [], _sources: [] })),
    runVerify: vi.fn(async () => ({
      rows: [{ claim: "unsourced claim", a: false, b: false, c: false, d: true }],
      counts: { rows: 1, failed_a: 1, failed_b: 1, failed_c: 1, failed_d: 0 },
      do_not_use: ["unsourced claim"],
      _sources: [],
      _log: [],
    })),
    runVerifyMessages: vi.fn(async () => ({
      per_person: [
        {
          person: "Jane Doe",
          sentences: [{ text: "generic line", label: "GENERIC" }],
          counts: { sentences: 1, from_pack: 0, generic: 1, made_up: 0, banned: 0 },
        },
      ],
      overall_from_pack_pct: 0,
      any_blocked: false,
      _sources: [],
      _log: [],
    })),
  };
});

import { createServer } from "../src/index.js";
import { request as httpRequest, type Server } from "node:http";
import {
  runIcp,
  runIndustry,
  runOutreach,
  runVerify,
  runVerifyMessages,
} from "../src/lib/outreach.js";
import { _resetForTest } from "../src/lib/outreachStore.js";

let server: Server;
let port: number;

function raw(
  path: string,
  opts: { method?: string; body?: string } = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path,
        method: opts.method ?? "GET",
        headers: {
          "content-type": "application/json",
          host: `127.0.0.1:${port}`,
          origin: `http://127.0.0.1:${port}`,
        },
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: b }));
      },
    );
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  _resetForTest();
  server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const a = server.address() as any;
  port = a.port;
  process.env.ARES_BRAIN_DASHBOARD_PORT = String(a.port);
});

async function closeServer() {
  delete process.env.ARES_BRAIN_DASHBOARD_PORT;
  await new Promise<void>((r) => server.close(() => r()));
}

async function createSession(): Promise<string> {
  const res = await raw("/api/outreach/session", {
    method: "POST",
    body: JSON.stringify({ myCompany: "Acme", whatIDo: "widgets" }),
  });
  return JSON.parse(res.body).sessionId;
}

describe("outreach routes", () => {
  it("POST /session rejects missing fields", async () => {
    const res = await raw("/api/outreach/session", {
      method: "POST",
      body: JSON.stringify({ myCompany: "" }),
    });
    expect(res.status).toBe(400);
    await closeServer();
  });

  it("POST /session then GET /state round-trips", async () => {
    const sessionId = await createSession();
    const res = await raw(`/api/outreach/state/${sessionId}`);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.state.myCompany).toBe("Acme");
    expect(body.state.sections.icp).toBeNull();
    await closeServer();
  });

  it("GET /state for an unknown session is 404", async () => {
    const res = await raw("/api/outreach/state/does-not-exist");
    expect(res.status).toBe(404);
    await closeServer();
  });

  it("POST /run/icp calls runIcp and stores the result", async () => {
    const sessionId = await createSession();
    const res = await raw("/api/outreach/run/icp", {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    });
    expect(res.status).toBe(200);
    expect(runIcp).toHaveBeenCalledWith("Acme", "widgets");
    const body = JSON.parse(res.body);
    expect(body.content.icp_summary).toBe("fake icp");
    expect(body.state.sections.icp.icp_summary).toBe("fake icp");
    await closeServer();
  });

  it("POST /run/industry before a target is set is a clean 400, not a crash", async () => {
    const sessionId = await createSession();
    const res = await raw("/api/outreach/run/industry", {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/target account/i);
    await closeServer();
  });

  it("POST /target clears downstream sections and unblocks /run/industry", async () => {
    const sessionId = await createSession();
    await raw("/api/outreach/run/icp", { method: "POST", body: JSON.stringify({ sessionId }) });
    await raw("/api/outreach/target", {
      method: "POST",
      body: JSON.stringify({ sessionId, targetAccount: "Onsurity" }),
    });
    const res = await raw("/api/outreach/run/industry", {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    });
    expect(res.status).toBe(200);
    expect(runIndustry).toHaveBeenCalledWith(
      "Acme",
      "widgets",
      { icp_summary: "fake icp", candidates: [], _sources: [] },
      "Onsurity",
    );
    await closeServer();
  });

  it("POST /edit stores hand-edited content and marks the section edited", async () => {
    const sessionId = await createSession();
    await raw("/api/outreach/run/icp", { method: "POST", body: JSON.stringify({ sessionId }) });
    const res = await raw("/api/outreach/edit", {
      method: "POST",
      body: JSON.stringify({ sessionId, section: "icp", content: { icp_summary: "hand edit" } }),
    });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.state.sections.icp.icp_summary).toBe("hand edit");
    expect(body.state.edited.icp).toBe(true);
    await closeServer();
  });

  it("POST /edit rejects a non-object content payload", async () => {
    const sessionId = await createSession();
    const res = await raw("/api/outreach/edit", {
      method: "POST",
      body: JSON.stringify({ sessionId, section: "icp", content: "not an object" }),
    });
    expect(res.status).toBe(400);
    await closeServer();
  });

  it("POST /run/bogus-section is a clean 400", async () => {
    const sessionId = await createSession();
    const res = await raw("/api/outreach/run/bogus-section", {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    });
    expect(res.status).toBe(400);
    await closeServer();
  });

  it("POST /verify grades a run section and bans its failed claims", async () => {
    const sessionId = await createSession();
    await raw("/api/outreach/target", {
      method: "POST",
      body: JSON.stringify({ sessionId, targetAccount: "Onsurity" }),
    });
    await raw("/api/outreach/run/company", { method: "POST", body: JSON.stringify({ sessionId }) });
    const res = await raw("/api/outreach/verify/company", {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    });
    expect(res.status).toBe(200);
    expect(runVerify).toHaveBeenCalledWith("company", { account_name: "fake co", _sources: [] });
    const body = JSON.parse(res.body);
    expect(body.state.doNotUse).toEqual(["unsourced claim"]);
    expect(body.state.verification.company.counts.failed_a).toBe(1);
    await closeServer();
  });

  it("POST /verify on a section with nothing run yet is a clean 400", async () => {
    const sessionId = await createSession();
    await raw("/api/outreach/target", {
      method: "POST",
      body: JSON.stringify({ sessionId, targetAccount: "Onsurity" }),
    });
    const res = await raw("/api/outreach/verify/company", {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    });
    expect(res.status).toBe(400);
    await closeServer();
  });

  it("POST /verify on icp (nothing gradeable) is a clean 400", async () => {
    const sessionId = await createSession();
    const res = await raw("/api/outreach/verify/icp", {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    });
    expect(res.status).toBe(400);
    await closeServer();
  });

  it("a banned claim from grading is passed into the outreach step", async () => {
    const sessionId = await createSession();
    await raw("/api/outreach/target", {
      method: "POST",
      body: JSON.stringify({ sessionId, targetAccount: "Onsurity" }),
    });
    await raw("/api/outreach/run/company", { method: "POST", body: JSON.stringify({ sessionId }) });
    await raw("/api/outreach/verify/company", {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    });
    await raw("/api/outreach/run/people", { method: "POST", body: JSON.stringify({ sessionId }) });
    await raw("/api/outreach/run/outreach", {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    });
    expect(runOutreach).toHaveBeenCalledWith(
      "Acme",
      "widgets",
      "Onsurity",
      { account_name: "fake co", _sources: [] },
      { personas: [], people: [], _sources: [] },
      ["unsourced claim"],
    );
    await closeServer();
  });

  it("POST /verify-messages grades the outreach step against the pack and scores it", async () => {
    const sessionId = await createSession();
    await raw("/api/outreach/target", {
      method: "POST",
      body: JSON.stringify({ sessionId, targetAccount: "Onsurity" }),
    });
    await raw("/api/outreach/run/company", { method: "POST", body: JSON.stringify({ sessionId }) });
    await raw("/api/outreach/run/people", { method: "POST", body: JSON.stringify({ sessionId }) });
    await raw("/api/outreach/run/outreach", {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    });
    const res = await raw("/api/outreach/verify-messages", {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    });
    expect(res.status).toBe(200);
    expect(runVerifyMessages).toHaveBeenCalledWith(
      { per_person: [], _sources: [] },
      {
        icp: null,
        industry: null,
        company: { account_name: "fake co", _sources: [] },
        people: { personas: [], people: [], _sources: [] },
      },
      [],
    );
    const body = JSON.parse(res.body);
    expect(body.state.verification.outreach.overall_from_pack_pct).toBe(0);
    await closeServer();
  });

  it("POST /verify-messages before outreach has run is a clean 400", async () => {
    const sessionId = await createSession();
    const res = await raw("/api/outreach/verify-messages", {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    });
    expect(res.status).toBe(400);
    await closeServer();
  });
});
