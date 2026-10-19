// "What's selling" summary for the dashboard. Built from the cached store data and
// stored per dataset, so the AI is only called once per data refresh.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { shopFromRequest } from "@/lib/session";
import { readCache, analyseVariants, clampLookback, parseOverrides } from "@/lib/digest";
import { buildSummary } from "@/lib/insights";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request) {
  const shop = shopFromRequest(request);
  if (!shop) return NextResponse.json({ error: "not_connected" }, { status: 401 });
  const shopRow = await prisma.shop.findUnique({ where: { shopDomain: shop }, include: { settings: true } });
  if (!shopRow || shopRow.uninstalledAt) return NextResponse.json({ error: "not_connected" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const base = shopRow.settings || {};
  const lookbackDays = clampLookback(shopRow, searchParams.get("lookback") ?? base.lookbackDays ?? 30);
  const regenerate = searchParams.get("regenerate") === "1";

  // Use whatever the dashboard last loaded (up to 24h old) rather than re-hitting Shopify.
  const blob = readCache(shopRow, lookbackDays, 24 * 60 * 60 * 1000);
  if (!blob) return NextResponse.json({ error: "no_data", message: "Load the dashboard data first." }, { status: 409 });

  const key = `${new Date(shopRow.cacheAt).toISOString()}|${lookbackDays}`;
  if (!regenerate && shopRow.insightKey === key && shopRow.insightJson) {
    try { return NextResponse.json({ ...JSON.parse(shopRow.insightJson), generatedAt: shopRow.insightAt, cached: true }); } catch {}
  }

  const { items, params } = analyseVariants(blob.list, {
    lookbackDays,
    leadTimeDays: base.leadTimeDays ?? 14,
    targetCoverDays: base.targetCoverDays ?? 30,
    vendorOverrides: parseOverrides(base),
  });
  const summary = await buildSummary(items, params);
  const generatedAt = new Date();
  await prisma.shop.update({
    where: { id: shopRow.id },
    data: { insightJson: JSON.stringify(summary), insightKey: key, insightAt: generatedAt },
  }).catch(() => {});
  return NextResponse.json({ ...summary, generatedAt, cached: false });
}
