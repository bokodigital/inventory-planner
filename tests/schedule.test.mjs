import { isDue, isScheduledDay, localParts } from "../lib/schedule.js";
let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) pass++; else { fail++; console.log("FAIL:", name); } };

// 22:00 UTC Sun 18 Oct 2026 = 09:00 Mon 19 Oct in Sydney (AEDT, UTC+11)
const n = localParts("Australia/Sydney", new Date("2026-10-18T22:00:00Z"));
t("sydney local parts", n.hour === 9 && n.dayOfWeek === 1 && n.dateKey === "2026-10-19");
// Winter: 22:00 UTC = 08:00 AEST
const w = localParts("Australia/Sydney", new Date("2026-06-14T22:00:00Z"));
t("sydney winter hour", w.hour === 8);

const weekly9 = { cadence: "weekly", dayOfWeek: 1, hour: 9 };
t("weekly due at chosen hour", isDue(weekly9, n, []));
t("not due before hour", !isDue({ ...weekly9, hour: 10 }, n, []));
const later = localParts("Australia/Sydney", new Date("2026-10-19T03:00:00Z")); // 14:00 Mon
t("catches up later same day (7am setting)", isDue({ ...weekly9, hour: 7 }, later, []));
t("2pm setting due at 2pm", isDue({ ...weekly9, hour: 14 }, later, []));
t("not resent same day", !isDue(weekly9, later, ["2026-10-19"]));
t("wrong weekday", !isDue({ ...weekly9, dayOfWeek: 2 }, n, []));
t("daily", isDue({ cadence: "daily", hour: 6 }, n, []));
t("monthly", isDue({ cadence: "monthly", dayOfMonth: 19, hour: 9 }, n, []) && !isDue({ cadence: "monthly", dayOfMonth: 20, hour: 9 }, n, []));
// Fortnightly alternates
const m1 = localParts("Australia/Sydney", new Date("2026-10-18T23:00:00Z"));
const m2 = localParts("Australia/Sydney", new Date("2026-10-25T23:00:00Z"));
const f = { cadence: "fortnightly", dayOfWeek: 1, hour: 9 };
t("fortnightly alternates", isScheduledDay(f, m1) !== isScheduledDay(f, m2));
t("bad timezone falls back", localParts("Not/AZone", new Date()).hour >= 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
