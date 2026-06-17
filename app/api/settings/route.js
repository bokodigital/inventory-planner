import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { shopFromRequest } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CADENCES = ["daily", "weekly", "fortnightly", "monthly"];
const clampInt = (v, min, max, dflt) => {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return dflt;
  return Math.min(max, Math.max(min, n));
};

async function loadShop(request) {
  const shop = shopFromRequest(request);
  if (!shop) return null;
  return prisma.shop.findUnique({ where: { shopDomain: shop }, include: { settings: true } });
}

export async function GET(request) {
  const shopRow = await loadShop(request);
  if (!shopRow) return NextResponse.json({ error: "not_connected" }, { status: 401 });
  return NextResponse.json({ shop: shopRow.shopDomain, settings: shopRow.settings });
}

export async function POST(request) {
  const shopRow = await loadShop(request);
  if (!shopRow) return NextResponse.json({ error: "not_connected" }, { status: 401 });
  const b = await request.json().catch(() => ({}));
  const data = {
    notifyEmail: typeof b.notifyEmail === "string" ? b.notifyEmail.trim() : undefined,
    lookbackDays: clampInt(b.lookbackDays, 7, 365, 30),
    leadTimeDays: clampInt(b.leadTimeDays, 0, 365, 14),
    targetCoverDays: clampInt(b.targetCoverDays, 1, 365, 30),
    cadence: CADENCES.includes(b.cadence) ? b.cadence : "weekly",
    dayOfWeek: clampInt(b.dayOfWeek, 0, 6, 1),
    dayOfMonth: clampInt(b.dayOfMonth, 1, 28, 1),
    hour: clampInt(b.hour, 0, 23, 9),
    timezone: typeof b.timezone === "string" && b.timezone ? b.timezone : "Australia/Sydney",
    enabled: b.enabled !== false,
  };
  const settings = await prisma.settings.upsert({
    where: { shopId: shopRow.id },
    update: data,
    create: { shopId: shopRow.id, ...data },
  });
  return NextResponse.json({ ok: true, settings });
}
