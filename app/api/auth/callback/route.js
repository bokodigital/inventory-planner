import { NextResponse } from "next/server";
import { isValidShop, verifyOauthHmac, exchangeToken, registerWebhooks } from "@/lib/shopify";
import { encrypt } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { signShop } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const shop = (searchParams.get("shop") || "").toLowerCase();
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const cookieState = request.cookies.get("bip_oauth_state")?.value;

  if (!isValidShop(shop) || !code) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  if (!state || state !== cookieState) return NextResponse.json({ error: "State mismatch" }, { status: 403 });
  if (!verifyOauthHmac(searchParams)) return NextResponse.json({ error: "HMAC verification failed" }, { status: 403 });

  let token, scope;
  try {
    const r = await exchangeToken(shop, code);
    token = r.access_token; scope = r.scope;
  } catch (e) {
    return NextResponse.json({ error: "Token exchange failed" }, { status: 502 });
  }

  const shopRow = await prisma.shop.upsert({
    where: { shopDomain: shop },
    update: { accessToken: encrypt(token), scopes: scope, uninstalledAt: null },
    create: { shopDomain: shop, accessToken: encrypt(token), scopes: scope },
  });
  await prisma.settings.upsert({
    where: { shopId: shopRow.id },
    update: {},
    create: { shopId: shopRow.id },
  });

  // fire-and-forget webhook registration
  registerWebhooks(shop, token, process.env.APP_URL).catch(() => {});

  const res = NextResponse.redirect(`${process.env.APP_URL}/settings`);
  res.cookies.set("bip_shop", signShop(shop), {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30,
  });
  res.cookies.delete("bip_oauth_state");
  res.cookies.delete("bip_oauth_shop");
  return res;
}
