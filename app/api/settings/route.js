import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { shopFromRequest } from "@/lib/session";
import { maxLookbackFor, CACHE_VERSION } from "@/lib/digest";
import { validTimezone } from "@/lib/schedule";

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

/** Supplier (vendor) names seen in the last fetched store data, for the overrides picker. */
function knownVendors(shopRow) {
  try {
    const blob = JSON.parse(shopRow.cacheVariants || "null");
    if (!blob || blob.v !== CACHE_VERSION) return [];
    return [...new Set(blob.list.map((v) => v.vendor).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  } catch { return []; }
}

function cleanOverrides(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const o of raw) {
    const vendor = String((o && o.vendor) || "").trim();
    if (!vendor || seen.has(vendor.toLowerCase())) continue;
    seen.add(vendor.toLowerCase());
    const lead = o.leadTimeDays === "" || o.leadTimeDays == null ? null : clampInt(o.leadTimeDays, 0, 365, null);
    const cover = o.targetCoverDays === "" || o.targetCoverDays == null ? null : clampInt(o.targetCoverDays, 1, 365, null);
    if (lead === null && cover === null) continue;
    out.push({ vendor, leadTimeDays: lead, targetCoverDays: cover });
  }
  return out.slice(0, 100);
}

export async function GET(request) {
  const shopRow = await loadShop(request);
  if (!shopRow) return NextResponse.json({ error: "not_connected" }, { status: 401 });
  const s = shopRow.settings;
  let overrides = [];
  try { overrides = s && s.vendorOverrides ? JSON.parse(s.vendorOverrides) : []; } catch {}
  return NextResponse.json({
    shop: shopRow.shopDomain,
    settings: s ? { ...s, vendorOverrides: overrides } : null,
    maxLookback: maxLookbackFor(shopRow),
    vendors: knownVendors(shopRow),
  });
}

export async function POST(request) {
  const shopRow = await loadShop(request);
  if (!shopRow) return NextResponse.json({ error: "not_connected" }, { status: 401 });
  const b = await request.json().catch(() => ({}));
  if (b.timezone && !validTimezone(b.timezone)) {
    return NextResponse.json({ error: "bad_timezone", message: `"${b.timezone}" isn't a recognised timezone. Use a name like Australia/Sydney.` }, { status: 400 });
  }
  const data = {
    notifyEmail: typeof b.notifyEmail === "string" ? b.notifyEmail.trim() : undefined,
    lookbackDays: clampInt(b.lookbackDays, 7, maxLookbackFor(shopRow), 30),
    leadTimeDays: clampInt(b.leadTimeDays, 0, 365, 14),
    targetCoverDays: clampInt(b.targetCoverDays, 1, 365, 30),
    cadence: CADENCES.includes(b.cadence) ? b.cadence : "weekly",
    dayOfWeek: clampInt(b.dayOfWeek, 0, 6, 1),
    dayOfMonth: clampInt(b.dayOfMonth, 1, 28, 1),
    hour: clampInt(b.hour, 0, 23, 9),
    timezone: typeof b.timezone === "string" && b.timezone ? b.timezone : "Australia/Sydney",
    enabled: b.enabled !== false,
    vendorOverrides: JSON.stringify(cleanOverrides(b.vendorOverrides)),
  };
  const settings = await prisma.settings.upsert({
    where: { shopId: shopRow.id },
    update: data,
    create: { shopId: shopRow.id, ...data },
  });
  // Saved digest inputs changed, so the cached summary may no longer match.
  await prisma.shop.update({ where: { id: shopRow.id }, data: { insightKey: null } }).catch(() => {});
  return NextResponse.json({ ok: true, settings: { ...settings, vendorOverrides: JSON.parse(settings.vendorOverrides || "[]") } });
}
