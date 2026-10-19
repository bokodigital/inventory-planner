import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildReorder } from "@/lib/digest";
import { buildSummary } from "@/lib/insights";
import { sendDigest } from "@/lib/email";
import { localParts, isDue } from "@/lib/schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Stop starting new shops after this long; anything left is picked up on the next run.
const START_BUDGET_MS = 200000;
const MAX_ERRORS_PER_DAY = 3;

export async function GET(request) {
  const auth = request.headers.get("authorization") || request.headers.get("x-cron-secret") || "";
  const expected = process.env.CRON_SECRET || "";
  const ok = auth === `Bearer ${expected}` || auth === expected;
  if (!expected || !ok) return new NextResponse("Unauthorized", { status: 401 });

  const started = Date.now();
  const shops = await prisma.shop.findMany({
    where: { uninstalledAt: null, settings: { enabled: true } },
    include: { settings: true },
  });

  const results = [];
  let deferred = 0;
  for (const shopRow of shops) {
    const s = shopRow.settings;
    if (!s || !s.notifyEmail) continue;
    const tz = s.timezone || "Australia/Sydney";
    const now = localParts(tz);

    const recent = await prisma.digestRun.findMany({
      where: { shopId: shopRow.id, status: { in: ["sent", "error"] }, ranAt: { gte: new Date(Date.now() - 48 * 3600 * 1000) } },
      select: { status: true, ranAt: true },
    });
    const sentKeys = recent.filter((r) => r.status === "sent").map((r) => localParts(tz, r.ranAt).dateKey);
    if (!isDue(s, now, sentKeys)) continue;
    const errorsToday = recent.filter((r) => r.status === "error" && localParts(tz, r.ranAt).dateKey === now.dateKey).length;
    if (errorsToday >= MAX_ERRORS_PER_DAY) continue;

    if (Date.now() - started > START_BUDGET_MS) { deferred++; continue; }

    try {
      const data = await buildReorder(prisma, shopRow, s, { deadline: started + 280000 });
      data.insights = await buildSummary(data.items, data.params).catch(() => null);
      const emailId = await sendDigest(s.notifyEmail, shopRow.shopDomain, data);
      await prisma.digestRun.create({ data: { shopId: shopRow.id, status: "sent", itemsFlagged: data.summary.orderNow, emailId } });
      results.push({ shop: shopRow.shopDomain, status: "sent", flagged: data.summary.orderNow });
    } catch (e) {
      await prisma.digestRun.create({ data: { shopId: shopRow.id, status: "error", error: String(e.message || e) } }).catch(() => {});
      results.push({ shop: shopRow.shopDomain, status: "error", error: String(e.message || e) });
    }
  }
  return NextResponse.json({ ran: results.length, deferred, results });
}
