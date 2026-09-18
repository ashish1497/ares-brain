/**
 * Minimal Leitner-style spaced-repetition scheduler for the cross-course Drill
 * deck. State lives in localStorage only — per-browser, never synced, never
 * sent anywhere. A card is identified by `${course}:${cardId}` so the same
 * numeric id in two different courses never collides.
 */

const STORAGE_KEY = "aresBrainDrillSRS";
const BOX_INTERVAL_DAYS = [0, 1, 3, 7, 21, 45];
const MAX_BOX = BOX_INTERVAL_DAYS.length - 1;

export type Grade = "again" | "good" | "easy";

interface CardState {
  box: number;
  due: number; // epoch ms
}

type Store = Record<string, CardState>;

function loadStore(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    return {};
  }
}

function saveStore(store: Store): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* private mode / quota — drill just won't persist across reloads */
  }
}

export function cardKey(course: string, cardId: number | string): string {
  return `${course}:${cardId}`;
}

/** Cards not yet seen default to box 0, due now — immediately eligible. */
export function getState(key: string): CardState {
  const store = loadStore();
  return store[key] ?? { box: 0, due: Date.now() };
}

export function isDue(key: string, now = Date.now()): boolean {
  return getState(key).due <= now;
}

/** Record a review outcome and reschedule the card. */
export function grade(key: string, g: Grade): void {
  const store = loadStore();
  const cur = store[key] ?? { box: 0, due: Date.now() };
  let box = cur.box;
  let multiplier = 1;
  if (g === "again") box = 0;
  else if (g === "good") box = Math.min(box + 1, MAX_BOX);
  else if (g === "easy") {
    box = Math.min(box + 2, MAX_BOX);
    multiplier = 1.3;
  }
  const days = g === "again" ? 0.02 : BOX_INTERVAL_DAYS[box] * multiplier; // ~30 min if "again"
  store[key] = { box, due: Date.now() + days * 86_400_000 };
  saveStore(store);
}

/** Small stats for a set of keys — how many are due now / total tracked / never seen. */
export function summarize(keys: string[]): { due: number; total: number; newCount: number } {
  const store = loadStore();
  const now = Date.now();
  let due = 0;
  let newCount = 0;
  for (const k of keys) {
    const s = store[k];
    if (!s) newCount++;
    if (!s || s.due <= now) due++;
  }
  return { due, total: keys.length, newCount };
}

export function resetAll(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
