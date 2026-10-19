import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { shopFromRequest } from "@/lib/session";
import { fetchVariants, analyseVariants, readCache, saveCache, clampLookback, maxLookbackFor, parseOverrides } from "@/lib/digest";
import { BulkTimeoutError } from "@/lib/shopify";

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
  const requestedLookback = searchParams.get("lookback") ?? base.lookbackDays ?? 30;
  const effective = {
    lookbackDays: clampLookback(shopRow, requestedLookback),
    leadTimeDays: clampInt(searchParams.get("lead"), 0, 365, base.leadTimeDays ?? 14),
    targetCoverDays: clampInt(searchParams.get("cover"), 1, 365, base.targetCoverDays ?? 30),
    vendorOverrides: parseOverrides(base),
  };
  const maxLookback = maxLookbackFor(shopRow);
  const lookbackCapped = parseInt(requestedLookback, 10) > maxLookback;

  try {
    // Analysis is cheap, so lead-time / cover changes recompute instantly from the cache.
    let blob = refresh ? null : readCache(shopRow, effective.lookbackDays, CACHE_MS);
    const fromCache = !!blob;
    if (!blob) {
      // Short wait per request; the dashboard polls and each poll resumes the same Shopify export.
      blob = await fetchVariants(shopRow, effective.lookbackDays, { deadline: Date.now() + 25000, prisma });
      await saveCache(prisma, shopRow, blob);
    }
    const data = analyseVariants(blob.list, effective);
    return NextResponse.json({
      shop, fromCache, cachedAt: fromCache ? shopRow.cacheAt : new Date(),
      maxLookback, lookbackCapped, meta: blob.meta, ...data,
    });
  } catch (e) {
    if (e instanceof BulkTimeoutError) {
      let startedAt = null;
      try { startedAt = JSON.parse(shopRow.pendingBulk || "null")?.startedAt || null; } catch {}
      return NextResponse.json({ loading: true, startedAt,
        message: "Shopify is preparing your store data. Large catalogues can take a few minutes." }, { status: 202 });
    }
    return NextResponse.json({ error: "shopify_error", message: String(e.message || e) }, { status: 502 });
  }
}
