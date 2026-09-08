import busboy from "busboy";
import { createWriteStream, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { IncomingMessage } from "node:http";
import { repoRoot } from "./repo.js";

const OK: Record<string, RegExp> = {
  book: /\.(pdf|docx)$/i,
  recording: /\.(m4a|mp3|wav|mp4|webm)$/i,
};

export function extOk(kind: "book" | "recording", name: string) {
  return OK[kind]?.test(name) ?? false;
}
export function safeName(name: string) {
  return basename(name)
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+/, "");
}

export function receiveUpload(
  req: IncomingMessage,
  course: string,
  kind: "book" | "recording",
): Promise<{ written: string[]; rejected: { name: string; reason: string }[] }> {
  return new Promise((resolve, reject) => {
    const dir = join(
      repoRoot(),
      "courses",
      course,
      "inbox",
      kind === "book" ? "books" : "recordings",
    );
    mkdirSync(dir, { recursive: true });
    const written: string[] = [];
    const rejected: { name: string; reason: string }[] = [];
    const bb = busboy({ headers: req.headers, limits: { fileSize: 512 * 1024 * 1024 } });
    const pending: Promise<void>[] = [];
    bb.on("file", (_field, stream, info) => {
      const name = safeName(info.filename || "file");
      if (!extOk(kind, name)) {
        rejected.push({ name, reason: "unsupported file type" });
        stream.resume();
        return;
      }
      pending.push(
        new Promise((res, rej) => {
          const ws = createWriteStream(join(dir, name));
          stream.pipe(ws);
          ws.on("finish", () => {
            written.push(name);
            res();
          });
          ws.on("error", rej);
        }),
      );
    });
    bb.on("close", () => Promise.all(pending).then(() => resolve({ written, rejected }), reject));
    bb.on("error", reject);
    req.pipe(bb);
  });
}
