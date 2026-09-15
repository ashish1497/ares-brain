/** One-line activity log — every request, job, gate check, and spawned
 * process writes exactly one line here so a `tail -f` on the server's
 * stdout (or its log file, if run under launchd/nohup) tells you what the
 * dashboard is actually doing, not just what it's showing. */

function ts(): string {
  return new Date().toTimeString().slice(0, 8);
}

export function log(scope: string, message: string): void {
  console.log(`[${ts()}] [${scope}] ${message}`);
}
