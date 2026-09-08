import type { ReactNode } from "react";
import { Badge } from "./ui/badge";

type State = "ok" | "soon" | "bad";

/**
 * A status pill in palette B. Either pass an explicit `state`, or a numeric `risk`
 * (0..1) which bands to bad (≥0.66) / soon (≥0.33) / ok. Fill comes from the
 * matching `--color-*` token, border from `--color-edge` (via `<Badge>`).
 */
export function RiskBadge({
  state,
  risk,
  children,
}: {
  state?: State;
  risk?: number;
  children?: ReactNode;
}) {
  const s: State =
    state ?? (risk == null ? "ok" : risk >= 0.66 ? "bad" : risk >= 0.33 ? "soon" : "ok");
  const label = children ?? { ok: "on track", soon: "watch", bad: "at risk" }[s];
  return <Badge variant={s}>{label}</Badge>;
}
