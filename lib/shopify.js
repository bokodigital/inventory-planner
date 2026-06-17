// Manual Shopify OAuth + Admin API helpers (no SDK).
import crypto from "crypto";

export const API_VERSION = "2024-10";

export function isValidShop(shop) {
  return typeof shop === "string" && /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop);
}

export function buildAuthUrl(shop, state, redirectUri) {
  const p = new URLSearchParams({
    client_id: process.env.SHOPIFY_API_KEY || "",
    scope: process.env.SHOPIFY_SCOPES || "",
    redirect_uri: redirectUri,
    state,
  });
  return `https://${shop}/admin/oauth/authorize?${p.toString()}`;
}

// Verify the HMAC on the OAuth callback query string.
export function verifyOauthHmac(searchParams) {
  const secret = process.env.SHOPIFY_API_SECRET || "";
  const pairs = [];
  for (const [k, v] of searchParams.entries()) {
    if (k === "hmac" || k === "signature") continue;
    pairs.push([k, v]);
  }
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const message = pairs.map(([k, v]) => `${k}=${v}`).join("&");
  const digest = crypto.createHmac("sha256", secret).update(message).digest("hex");
  const provided = searchParams.get("hmac") || "";
  try {
    return crypto.timingSafeEqual(Buffer.from(digest, "utf8"), Buffer.from(provided, "utf8"));
  } catch {
    return false;
  }
}

export async function exchangeToken(shop, code) {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      code,
    }),
  });
  if (!res.ok) throw new Error("Token exchange failed: " + res.status);
  return res.json(); // { access_token, scope }
}

// Verify a webhook payload's HMAC (raw body + base64 header).
export function verifyWebhookHmac(rawBody, hmacHeader) {
  const secret = process.env.SHOPIFY_API_SECRET || "";
  const digest = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader || ""));
  } catch {
    return false;
  }
}

export async function adminGraphQL(shop, token, query, variables) {
  const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error("GraphQL error: " + JSON.stringify(json.errors));
  return json.data;
}

export async function registerWebhooks(shop, token, appUrl) {
  const topics = ["APP_UNINSTALLED", "CUSTOMERS_DATA_REQUEST", "CUSTOMERS_REDACT", "SHOP_REDACT"];
  const mutation = `mutation reg($topic: WebhookSubscriptionTopic!, $url: URL!) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: { callbackUrl: $url, format: JSON }) {
      userErrors { field message }
    }
  }`;
  for (const topic of topics) {
    try {
      await adminGraphQL(shop, token, mutation, { topic, url: `${appUrl}/api/webhooks` });
    } catch (e) {
      console.warn("webhook registration failed:", topic, e.message);
    }
  }
}
