import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { shopFromRequest } from "@/lib/session";
import { buildReorder } from "@/lib/digest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request) {
  const shop = shopFromRequest(request);
  if (!shop) return NextResponse.json({ error: "not_connected" }, { status: 401 });
  const shopRow = await prisma.shop.findUnique({ where: { shopDomain: shop }, include: { settings: true } });
  if (!shopRow || shopRow.uninstalledAt) return NextResponse.json({ error: "not_connected" }, { status: 401 });

  // Allow the dashboard to override the saved settings via query params (filter controls).
  const { searchParams } = new URL(request.url);
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
    const data = await buildReorder(shopRow, effective);
    return NextResponse.json({ shop, ...data });
  } catch (e) {
    return NextResponse.json({ error: "shopify_error", message: String(e.message || e) }, { status: 502 });
  }
}
