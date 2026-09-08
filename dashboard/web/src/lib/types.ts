import type { Overview } from "../api";

/** Uniform prop superset every tab component receives; placeholders ignore what they don't need. */
export interface TabProps {
  ov: Overview;
  onJob: (kind: string, opts?: Record<string, string>) => void;
  busy: boolean;
  go: (hash: string) => void;
  params: string[];
}
