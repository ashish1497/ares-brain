import { describe, it, expect, vi } from "vitest";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

import { spawn } from "node:child_process";
import { probeClaudeCli } from "../src/lib/claudeProbe.js";
import { EventEmitter } from "node:events";

function fakeChild(stdoutText: string) {
  const child: any = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  setImmediate(() => {
    child.stdout.emit("data", Buffer.from(stdoutText));
    child.emit("close", 0);
  });
  return child;
}

describe("probeClaudeCli", () => {
  it("resolves true when output has no auth-failure markers", async () => {
    (spawn as any).mockReturnValue(fakeChild("Unknown skill: __ares_brain_setup_probe__\n"));
    expect(await probeClaudeCli()).toBe(true);
  });

  it("resolves false when output says Not logged in", async () => {
    (spawn as any).mockReturnValue(fakeChild("Not logged in · Please run /login\n"));
    expect(await probeClaudeCli()).toBe(false);
  });

  it("resolves false when output says revoked", async () => {
    (spawn as any).mockReturnValue(
      fakeChild('{"error":{"message":"OAuth access token has been revoked."}}\n'),
    );
    expect(await probeClaudeCli()).toBe(false);
  });

  it("resolves false on spawn error", async () => {
    const child: any = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    (spawn as any).mockReturnValue(child);
    const p = probeClaudeCli(200);
    setImmediate(() => child.emit("error", new Error("ENOENT")));
    expect(await p).toBe(false);
  });
});
