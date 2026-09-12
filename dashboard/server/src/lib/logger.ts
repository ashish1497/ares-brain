/** A single-line progress callback, threaded through the research pipeline
 * so the UI can show what actually happened at each step — not just a
 * spinner. Every push is timestamped by the caller collecting them. */
export type Logger = (line: string) => void;
