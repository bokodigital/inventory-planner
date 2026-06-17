import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { shopFromRequest } from "@/lib/session";
import { buildReorder } from "@/lib/digest";
import { sendDigest } from "@/lib/email";

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
    const data = await buildReorder(shopRow, shopRow.settings);
    const emailId = await sendDigest(to, shopRow.shopDomain, data);
    await prisma.digestRun.create({ data: { shopId: shopRow.id, status: "sent", itemsFlagged: data.summary.orderNow, emailId } });
    return NextResponse.json({ ok: true, to, flagged: data.summary.orderNow });
  } catch (e) {
    await prisma.digestRun.create({ data: { shopId: shopRow.id, status: "error", error: String(e.message || e) } }).catch(() => {});
    return NextResponse.json({ error: "send_failed", message: String(e.message || e) }, { status: 502 });
  }
}
