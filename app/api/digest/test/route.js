import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { shopFromRequest } from "@/lib/session";
import { buildReorder } from "@/lib/digest";
import { buildSummary } from "@/lib/insights";
import { sendDigest } from "@/lib/email";
import { BulkTimeoutError } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request) {
  const shop = shopFromRequest(request);
  if (!shop) return NextResponse.json({ error: "not_connected" }, { status: 401 });
  const shopRow = await prisma.shop.findUnique({ where: { shopDomain: shop }, include: { settings: true } });
  if (!shopRow) return NextResponse.json({ error: "not_connected" }, { status: 401 });
  const to = shopRow.settings && shopRow.settings.notifyEmail;
  if (!to) return NextResponse.json({ error: "no_email", message: "Set a notification email first." }, { status: 400 });
  try {
    const data = await buildReorder(prisma, shopRow, shopRow.settings, { deadline: Date.now() + 40000 });
    data.insights = await buildSummary(data.items, data.params).catch(() => null);
    const emailId = await sendDigest(to, shopRow.shopDomain, data);
    // Recorded as "test" so it never blocks that day's scheduled digest.
    await prisma.digestRun.create({ data: { shopId: shopRow.id, status: "test", itemsFlagged: data.summary.orderNow, emailId } });
    return NextResponse.json({ ok: true, to, flagged: data.summary.orderNow });
  } catch (e) {
    const msg = e instanceof BulkTimeoutError
      ? "Shopify is still preparing your store data. Open the dashboard, wait for it to load, then try again."
      : String(e.message || e);
    await prisma.digestRun.create({ data: { shopId: shopRow.id, status: "error", error: msg } }).catch(() => {});
    return NextResponse.json({ error: "send_failed", message: msg }, { status: 502 });
  }
}
