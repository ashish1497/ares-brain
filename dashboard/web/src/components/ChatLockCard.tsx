import { Section } from "./Section";
import { Progress } from "./ui/progress";
import type { OverviewKpis } from "../api";

/**
 * The phase-2 chat gate. Locked until `brainReady >= chatUnlockAt`; the progress bar
 * fills to `brainReady / chatUnlockAt`. When unlocked, the panel just says phase 2.
 */
export function ChatLockCard({ k, unlockAt }: { k: OverviewKpis; unlockAt: number }) {
  const locked = k.brainReady < unlockAt;
  const pct = unlockAt > 0 ? Math.min(100, (k.brainReady / unlockAt) * 100) : 100;
  return (
    <Section title="Chat">
      {locked ? (
        <div className="flex flex-col gap-2 text-sm">
          <div>
            {k.brainReady} of {k.courseCount} brains ready — chat unlocks at {unlockAt}
          </div>
          <Progress value={pct} />
          <input
            disabled
            placeholder="Chat unlocks when enough course brains are ready"
            className="w-full rounded-[var(--radius-nb)] border-[length:var(--nb-border)] border-[var(--color-edge)] bg-[var(--color-paper)] p-2 opacity-50"
          />
        </div>
      ) : (
        <div className="text-sm">ready — chat lands in phase 2</div>
      )}
    </Section>
  );
}
