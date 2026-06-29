import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { shopFromRequest } from "@/lib/session";
import { fetchVariants, analyseVariants } from "@/lib/digest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CACHE_MS = 60 * 60 * 1000; // 1 hour

export async function GET(request) {
  const shop = shopFromRequest(request);
  if (!shop) return NextResponse.json({ error: "not_connected" }, { status: 401 });
  const shopRow = await prisma.shop.findUnique({ where: { shopDomain: shop }, include: { settings: true } });
  if (!shopRow || shopRow.uninstalledAt) return NextResponse.json({ error: "not_connected" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const refresh = searchParams.get("refresh") === "1";
  const clampInt = (v, min, max, dflt) => {
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? dflt : Math.min(max, Math.max(min, n));
  };
  const base = shopRow.settings || {};
  const effective = {
    lookbackDays: clampInt(searchParams.get("lookback"), 7, 365, base.lookbackDays ?? 30),
    leadTimeDays: clampInt(searchParams.get("lead"), 0, 365, base.leadTimeDays ?? 14),
    targetCoverDays: clampInt(searchParams.get("cover"), 1, 365, base.targetCoverDays ?? 30),
  };

  try {
    // Serve fetched variant data from cache when fresh + same lookback (analysis is cheap,
    // so lead-time / cover changes recompute instantly without re-hitting Shopify).
    let list = null;
    let fromCache = false;
    const fresh = shopRow.cacheAt && (Date.now() - new Date(shopRow.cacheAt).getTime()) < CACHE_MS;
    if (!refresh && fresh && shopRow.cacheLookback === effective.lookbackDays && shopRow.cacheVariants) {
      try { list = JSON.parse(shopRow.cacheVariants); fromCache = true; } catch {}
    }
    if (!list) {
      list = await fetchVariants(shopRow, effective.lookbackDays);
      await prisma.shop.update({
        where: { id: shopRow.id },
        data: { cacheVariants: JSON.stringify(list), cacheLookback: effective.lookbackDays, cacheAt: new Date() },
      }).catch(() => {});
    }
    const data = analyseVariants(list, effective);
    return NextResponse.json({ shop, fromCache, cachedAt: fromCache ? shopRow.cacheAt : new Date(), ...data });
  } catch (e) {
    return NextResponse.json({ error: "shopify_error", message: String(e.message || e) }, { status: 502 });
  }
}
