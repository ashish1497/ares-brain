import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
import { spawn } from "node:child_process";
import { runClaude } from "../src/lib/claudeRunner.js";

function fakeChild() {
  const child: any = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

describe("runClaude", () => {
  it("spawns claude -p with the message and a scoped allowlist", () => {
    const child = fakeChild();
    (spawn as any).mockReturnValue(child);
    runClaude("what's due this week?", () => {});
    const [bin, args] = (spawn as any).mock.calls[0];
    expect(bin).toBe("claude");
    expect(args).toContain("-p");
    expect(args).toContain("what's due this week?");
    expect(args).toContain("--allowedTools");
  });

  it("I13: allowlist mirrors the daily job's Bash(cd:*)+scraper pair, drops daily-only entries", () => {
    const child = fakeChild();
    (spawn as any).mockReturnValue(child);
    runClaude("hi", () => {});
    const [, args] = (spawn as any).mock.calls[0];
    const allowedTools = args[args.indexOf("--allowedTools") + 1] as string;
    const tools = allowedTools.split(",");
    // Bash(cd:*) is inert without the scraper-invocation grant right after it.
    expect(tools).toContain("Bash(cd:*)");
    expect(tools).toContain("Bash(uv run python lms_scrape.py:*)");
    // Daily-only entries (mac notifications, the daily-brief file) don't apply to chat.
    expect(tools).not.toContain("Bash(osascript:*)");
    expect(tools).not.toContain("Write(daily/**)");
  });

  it("streams stdout lines to onLine", async () => {
    const child = fakeChild();
    (spawn as any).mockReturnValue(child);
    const lines: string[] = [];
    const { done } = runClaude("hi", (l) => lines.push(l));
    child.stdout.emit("data", Buffer.from("line one\nline two\n"));
    child.emit("close", 0);
    await done;
    expect(lines).toEqual(["line one", "line two"]);
  });

  it("resolves code 1 and reports on spawn error", async () => {
    const child = fakeChild();
    (spawn as any).mockReturnValue(child);
    const lines: string[] = [];
    const { done } = runClaude("hi", (l) => lines.push(l));
    child.emit("error", new Error("ENOENT"));
    const { code } = await done;
    expect(code).toBe(1);
    expect(lines[0]).toMatch(/spawn error/);
  });

  it("kill() calls child.kill", () => {
    const child = fakeChild();
    (spawn as any).mockReturnValue(child);
    const { kill } = runClaude("hi", () => {});
    kill();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });
});
