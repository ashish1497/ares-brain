import { useState } from "react";
import * as api from "../api";
import { Button } from "./ui/button";
import { JobLog } from "./JobLog";
import type { Job } from "../api";

export function ChatPanel() {
  const [message, setMessage] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [lines, setLines] = useState<string[]>([]);

  const send = async () => {
    const text = message.trim();
    if (!text) return;
    const { jobId, error } = await api.startJob({ kind: "chat", message: text });
    if (error || !jobId) return;
    setLines([]);
    setJob({
      id: jobId,
      kind: "chat",
      status: "running",
      startedAt: new Date().toISOString(),
      log: [],
    });
    api.streamLog(
      jobId,
      (l) => setLines((prev) => [...prev, l]),
      (exitCode) => setJob((j) => (j ? { ...j, status: exitCode === 0 ? "done" : "failed" } : j)),
    );
    setMessage("");
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-nb border-[3px] border-edge bg-card px-3 py-2"
          placeholder="Ask ares-brain anything — e.g. /mesa:ares-brain-testprep <course>"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <Button type="button" onClick={send}>
          Send
        </Button>
      </div>
      <JobLog job={job} lines={lines} />
    </div>
  );
}
