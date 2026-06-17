import { NextResponse } from "next/server";
import crypto from "crypto";
import { isValidShop, buildAuthUrl } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  let shop = (searchParams.get("shop") || "").trim().toLowerCase();
  if (shop && !shop.includes(".")) shop = `${shop}.myshopify.com`;
  if (!isValidShop(shop)) {
    return NextResponse.json({ error: "Invalid shop domain" }, { status: 400 });
  }
  const state = crypto.randomBytes(16).toString("hex");
  const redirectUri = `${process.env.APP_URL}/api/auth/callback`;
  const res = NextResponse.redirect(buildAuthUrl(shop, state, redirectUri));
  const opts = { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 };
  res.cookies.set("bip_oauth_state", state, opts);
  res.cookies.set("bip_oauth_shop", shop, opts);
  return res;
}
