// Lightweight signed-cookie session: identifies the connected shop.
import crypto from "crypto";

function secret() {
  return process.env.SHOPIFY_API_SECRET || process.env.CRON_SECRET || "dev-secret";
}

export function signShop(shop) {
  const sig = crypto.createHmac("sha256", secret()).update(shop).digest("hex");
  return `${shop}.${sig}`;
}

export function verifyShopCookie(value) {
  if (!value) return null;
  const i = value.lastIndexOf(".");
  if (i < 0) return null;
  const shop = value.slice(0, i);
  const sig = value.slice(i + 1);
  const expected = crypto.createHmac("sha256", secret()).update(shop).digest("hex");
  try {
    if (crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return shop;
  } catch {}
  return null;
}

/** Read the connected shop domain from a Next request, or null. */
export function shopFromRequest(request) {
  const raw = request.cookies.get("bip_shop")?.value;
  return verifyShopCookie(raw);
}
