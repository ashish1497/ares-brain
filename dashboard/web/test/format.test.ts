import { countdown, fmtDate, fmtScrapeAge, fmtTime, relTime } from "../src/lib/format";

test("fmtTime formats an ISO datetime as local 24h HH:MM", () => {
  expect(fmtTime("2026-09-08T09:30:00")).toBe("09:30");
});

test("fmtTime falls back to the raw string when unparseable", () => {
  expect(fmtTime("not-a-date")).toBe("not-a-date");
});

test("fmtDate formats a YYYY-MM-DD as local weekday/day/month", () => {
  expect(fmtDate("2026-09-09")).toBe("Wed 9 Sep");
});

test("fmtDate dodges the UTC date-shift trap for a plain ymd string", () => {
  const original = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
  try {
    // Naively parsing "2026-09-09" as UTC and rendering in a negative-offset zone
    // would print "Tue 8 Sep" — the T00:00 trick must keep it on the 9th.
    expect(fmtDate("2026-09-09")).toBe("Wed 9 Sep");
  } finally {
    process.env.TZ = original;
  }
});

test("fmtDate is not affected by a locale that abbreviates September as 'Sept'", () => {
  // en-GB's Intl abbreviates September as "Sept" (4 letters) rather than "Sep" —
  // simulate that by stubbing toLocaleDateString the way such a locale would behave.
  // Against the old implementation (which composed the string from
  // toLocaleDateString calls) this reproduces "Wed 9 Sept"; the fix must not call
  // toLocaleDateString for the month at all.
  const spy = vi.spyOn(Date.prototype, "toLocaleDateString").mockImplementation(function (
    this: Date,
    _locales?: Intl.LocalesArgument,
    options?: Intl.DateTimeFormatOptions,
  ) {
    if (options?.month === "short") return "Sept";
    if (options?.weekday === "short") return "Wed";
    return "";
  });
  try {
    expect(fmtDate("2026-09-09")).toBe("Wed 9 Sep");
  } finally {
    spy.mockRestore();
  }
});

test("relTime reports a future ISO instant as 'in Nh'", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-09T00:00:00Z"));
  try {
    expect(relTime("2026-09-09T03:00:00Z")).toBe("in 3h");
  } finally {
    vi.useRealTimers();
  }
});

test("relTime reports a past ISO instant as 'Nm ago'", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-09T00:30:00Z"));
  try {
    expect(relTime("2026-09-09T00:00:00Z")).toBe("30m ago");
  } finally {
    vi.useRealTimers();
  }
});

test("countdown reports a future ISO instant as 'Nd Nh'", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-09T00:00:00Z"));
  try {
    expect(countdown("2026-09-11T04:00:00Z")).toBe("2d 4h");
  } finally {
    vi.useRealTimers();
  }
});

test("countdown parses a date-only YYYY-MM-DD as local midnight, not UTC", () => {
  const original = process.env.TZ;
  process.env.TZ = "Asia/Calcutta";
  vi.useFakeTimers();
  // Local midnight on the 9th (Asia/Calcutta, UTC+5:30) is 2026-09-08T18:30:00Z — earlier
  // than the naive UTC-midnight reading of "2026-09-09" (2026-09-09T00:00:00Z). At this
  // system time the local-midnight parse must already report "overdue"; the old
  // UTC-parsing bug would instead still show hours remaining until the (later) UTC anchor.
  vi.setSystemTime(new Date("2026-09-08T20:00:00Z"));
  try {
    expect(countdown("2026-09-09")).toBe("overdue");
  } finally {
    vi.useRealTimers();
    process.env.TZ = original;
  }
});

test("countdown reports a past ISO instant as 'overdue'", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-09T00:00:00Z"));
  try {
    expect(countdown("2026-09-08T00:00:00Z")).toBe("overdue");
  } finally {
    vi.useRealTimers();
  }
});

test("fmtScrapeAge renders minutes for a sub-hour age and never prints 0h", () => {
  expect(fmtScrapeAge(0.3)).toBe("18m ago");
});

test("fmtScrapeAge renders hours for a multi-hour age", () => {
  expect(fmtScrapeAge(9)).toBe("9h ago");
});
