import { runScraper } from "../lib/python.js";

export function buildTranscribeArgs(args: { course?: string } = {}): string[] {
  const argv = ["transcribe"];
  if (args.course) argv.push("--course", args.course);
  return argv;
}

export const transcribeTool = {
  name: "transcribe",
  description:
    "Transcribe class recordings for all courses (or one) using yt-dlp + faster-whisper. Reads courses/<slug>/raw/recordings.json; writes courses/<slug>/transcripts/<id>.md. Skips already-transcribed recordings; records unfetchable ones as needs-manual.",
  inputSchema: {
    type: "object",
    properties: { course: { type: "string", description: "Optional course slug." } },
  } as const,
  async handler(args: { course?: string } = {}) {
    const run = await runScraper(buildTranscribeArgs(args));
    return run.error
      ? { ok: false as const, error: run.error }
      : { ok: run.ok, summary: run.summary, stderr: run.stderr.slice(-2000) };
  },
};
