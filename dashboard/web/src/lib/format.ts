/** Parses a plain `YYYY-MM-DD` as local midnight to dodge the UTC date-shift trap. */
function parseYmdOrIso(isoOrYmd: string): Date {
  const isYmd = /^\d{4}-\d{2}-\d{2}$/.test(isoOrYmd);
  return new Date(isYmd ? `${isoOrYmd}T00:00` : isoOrYmd);
}

/** Splits a `·`-joined reason string into MetaRow parts; a reason with no `·` renders unchanged. */
export function reasonParts(reason: string): string[] {
  return reason.split("·").map((part) => part.trim());
}

/** ISO datetime → "09:30" (local, 24h). Falls back to the raw string if unparseable. */
export function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** ISO datetime or `YYYY-MM-DD` → "Wed 9 Sep" (local). Falls back to the raw string. */
export function fmtDate(isoOrYmd: string): string {
  const d = parseYmdOrIso(isoOrYmd);
  if (Number.isNaN(d.getTime())) return isoOrYmd;
  // Built from a fixed English weekday/month table (not toLocaleDateString) because
  // the host's locale can produce a non-3-letter abbreviation (e.g. en-GB's "Sept"
  // for September) or a different field order — this pins "Www D Mon" regardless
  // of the host's `LANG`/locale.
  const weekday = WEEKDAYS[d.getDay()];
  const day = d.getDate();
  const month = MONTHS[d.getMonth()];
  return `${weekday} ${day} ${month}`;
}

/** ISO datetime → "in 3h" / "24m ago" (local, relative to now). Falls back to the raw string. */
export function relTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diffMs = d.getTime() - Date.now();
  const past = diffMs <= 0;
  const abs = Math.abs(diffMs);
  const mins = Math.round(abs / 60000);
  const hrs = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);
  let label: string;
  if (mins < 60) label = `${mins}m`;
  else if (hrs < 24) label = `${hrs}h`;
  else label = `${days}d`;
  return past ? `${label} ago` : `in ${label}`;
}

/** `scrapeAgeHours` (fractional — e.g. `0.3`) → `"18m ago"` / `"9h ago"`. Never prints `0h`. */
export function fmtScrapeAge(hours: number): string {
  if (hours < 1) {
    const mins = Math.max(1, Math.round(hours * 60));
    return `${mins}m ago`;
  }
  return `${Math.round(hours)}h ago`;
}

/** ISO datetime or `YYYY-MM-DD` → "2d 4h" countdown, or "overdue" once it has passed. */
export function countdown(iso: string): string {
  const d = parseYmdOrIso(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diffMs = d.getTime() - Date.now();
  if (diffMs <= 0) return "overdue";
  const totalHours = Math.floor(diffMs / 3_600_000);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return days > 0 ? `${days}d ${hours}h` : `${hours}h`;
}
