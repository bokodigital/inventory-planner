// Pure scheduling helpers (unit-tested). The dispatcher can run hourly or less often:
// a digest is due on its scheduled day once the local time has reached the chosen hour,
// and it is sent at most once per local day. A missed run catches up on the next run.

const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function validTimezone(tz) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

/** Local calendar parts for an instant in a timezone. */
export function localParts(tz, date = new Date()) {
  const zone = validTimezone(tz) ? tz : "Australia/Sydney";
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, weekday: "short", hour: "numeric", hour12: false,
    day: "numeric", year: "numeric", month: "numeric",
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  const y = +p.year, m = +p.month, d = +p.day;
  return {
    hour: parseInt(p.hour, 10) % 24,
    dayOfWeek: WEEKDAY[p.weekday],
    dayOfMonth: d,
    dateKey: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    dayNumber: Math.floor(Date.UTC(y, m - 1, d) / 86400000), // local calendar day index
  };
}

/** Is today a scheduled day for these settings? */
export function isScheduledDay(s, now) {
  const cadence = s.cadence || "weekly";
  if (cadence === "daily") return true;
  if (cadence === "weekly") return s.dayOfWeek === now.dayOfWeek;
  if (cadence === "fortnightly") {
    if (s.dayOfWeek !== now.dayOfWeek) return false;
    return Math.floor(now.dayNumber / 7) % 2 === 0; // fixed alternating weeks
  }
  if (cadence === "monthly") return s.dayOfMonth === now.dayOfMonth;
  return false;
}

/**
 * Due when it's a scheduled day, the chosen hour has been reached locally, and no
 * scheduled digest has gone out yet on this local date.
 * @param sentDateKeys local dateKeys (same timezone) of recent successful scheduled sends
 */
export function isDue(s, now, sentDateKeys = []) {
  if (!isScheduledDay(s, now)) return false;
  if (now.hour < (s.hour ?? 9)) return false;
  return !sentDateKeys.includes(now.dateKey);
}
