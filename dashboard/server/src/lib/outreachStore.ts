/** In-memory session state for the outreach agent — same eviction shape as
 * the job tracker, keyed by an opaque id the client holds onto. No section
 * is a locked artifact: each is stored on its own and can be edited or
 * re-run independently. */

import { randomUUID } from "node:crypto";

export const SECTION_ORDER = ["icp", "industry", "company", "people", "outreach"] as const;
export type Section = (typeof SECTION_ORDER)[number];

export interface OutreachState {
  myCompany: string;
  whatIDo: string;
  targetAccount: string | null;
  sections: Record<Section, Record<string, unknown> | null>;
  edited: Record<Section, boolean>;
  /** Independent grading pass output per section — null until "Verify" is run. */
  verification: Partial<Record<Section, Record<string, unknown> | null>>;
  /** Claims banned by any grading pass so far, deduped, fed into the outreach prompt. */
  doNotUse: string[];
  touchedAt: number;
}

const SESSIONS = new Map<string, OutreachState>();
const MAX_SESSIONS = 40;

function emptySections(): Record<Section, Record<string, unknown> | null> {
  return { icp: null, industry: null, company: null, people: null, outreach: null };
}
function emptyEdited(): Record<Section, boolean> {
  return { icp: false, industry: false, company: false, people: false, outreach: false };
}

export function createSession(
  myCompany: string,
  whatIDo: string,
): { id: string; state: OutreachState } {
  if (SESSIONS.size >= MAX_SESSIONS) {
    let oldestId: string | null = null;
    let oldestAt = Infinity;
    for (const [id, s] of SESSIONS) {
      if (s.touchedAt < oldestAt) {
        oldestAt = s.touchedAt;
        oldestId = id;
      }
    }
    if (oldestId) SESSIONS.delete(oldestId);
  }
  const id = randomUUID();
  const state: OutreachState = {
    myCompany,
    whatIDo,
    targetAccount: null,
    sections: emptySections(),
    edited: emptyEdited(),
    verification: {},
    doNotUse: [],
    touchedAt: Date.now(),
  };
  SESSIONS.set(id, state);
  return { id, state };
}

export function getSession(id: string): OutreachState | undefined {
  const s = SESSIONS.get(id);
  if (s) s.touchedAt = Date.now();
  return s;
}

/** Test-only reset, mirrors jobs.ts's _resetForTest convention. */
export function _resetForTest(): void {
  SESSIONS.clear();
}
