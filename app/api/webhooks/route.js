import { NextResponse } from "next/server";
import { verifyWebhookHmac } from "@/lib/shopify";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const raw = await request.text();
  const hmac = request.headers.get("x-shopify-hmac-sha256");
  if (!verifyWebhookHmac(raw, hmac)) return new NextResponse("Unauthorized", { status: 401 });

  const topic = request.headers.get("x-shopify-topic") || "";
  const shop = request.headers.get("x-shopify-shop-domain") || "";

  try {
    if (topic === "app/uninstalled" && shop) {
      await prisma.shop.updateMany({ where: { shopDomain: shop }, data: { uninstalledAt: new Date() } });
      await prisma.settings.updateMany({ where: { shop: { shopDomain: shop } }, data: { enabled: false } });
    } else if (topic === "shop/redact" && shop) {
      await prisma.shop.deleteMany({ where: { shopDomain: shop } });
    }
    // customers/data_request & customers/redact: this app stores no customer PII -> just acknowledge.
  } catch (e) {
    console.error("webhook handler error:", e);
  }
  return NextResponse.json({ ok: true });
}
