import { afterEach, expect, test, vi } from "vitest";
import { getOverview } from "../src/api";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("getOverview parses the body on a 2xx response", async () => {
  const body = { term: "Term 1", kpis: { courseCount: 17 } };
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  });
  vi.stubGlobal("fetch", fetchMock);

  await expect(getOverview()).resolves.toEqual(body);
  expect(fetchMock).toHaveBeenCalledWith("/api/overview");
});

test("getOverview throws on a non-2xx response", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.resolve({}),
    }),
  );

  await expect(getOverview()).rejects.toThrow("overview 503");
});
