import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildReorder } from "@/lib/digest";
import { sendDigest } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Local time parts for a timezone.
function localParts(tz) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "short", hour: "numeric", hour12: false,
    day: "numeric", year: "numeric", month: "numeric",
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    hour: parseInt(parts.hour, 10) % 24,
    dayOfWeek: weekdayMap[parts.weekday],
    dayOfMonth: parseInt(parts.day, 10),
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

function isDue(s, now) {
  if (s.hour !== now.hour) return false;
  if (s.cadence === "daily") return true;
  if (s.cadence === "weekly") return s.dayOfWeek === now.dayOfWeek;
  if (s.cadence === "fortnightly") {
    if (s.dayOfWeek !== now.dayOfWeek) return false;
    const weeks = Math.floor(Date.now() / (7 * 86400000));
    return weeks % 2 === 0; // deterministic fortnight parity
  }
  if (s.cadence === "monthly") return s.dayOfMonth === now.dayOfMonth;
  return false;
}

export async function GET(request) {
  const auth = request.headers.get("authorization") || request.headers.get("x-cron-secret") || "";
  const expected = process.env.CRON_SECRET || "";
  const ok = auth === `Bearer ${expected}` || auth === expected;
  if (!expected || !ok) return new NextResponse("Unauthorized", { status: 401 });

  const shops = await prisma.shop.findMany({
    where: { uninstalledAt: null, settings: { enabled: true } },
    include: { settings: true },
  });

  const results = [];
  for (const shopRow of shops) {
    const s = shopRow.settings;
    if (!s || !s.notifyEmail) continue;
    const now = localParts(s.timezone || "Australia/Sydney");
    if (!isDue(s, now)) continue;

    // de-dupe: skip if already sent today (this shop's local date)
    const dayStart = new Date(Date.now() - 23 * 3600 * 1000);
    const recent = await prisma.digestRun.findFirst({
      where: { shopId: shopRow.id, status: "sent", ranAt: { gte: dayStart } },
    });
    if (recent) continue;

    try {
      const data = await buildReorder(shopRow, s);
      const emailId = await sendDigest(s.notifyEmail, shopRow.shopDomain, data);
      await prisma.digestRun.create({ data: { shopId: shopRow.id, status: "sent", itemsFlagged: data.summary.orderNow, emailId } });
      results.push({ shop: shopRow.shopDomain, status: "sent", flagged: data.summary.orderNow });
    } catch (e) {
      await prisma.digestRun.create({ data: { shopId: shopRow.id, status: "error", error: String(e.message || e) } }).catch(() => {});
      results.push({ shop: shopRow.shopDomain, status: "error", error: String(e.message || e) });
    }
  }
  return NextResponse.json({ ran: results.length, results });
}
