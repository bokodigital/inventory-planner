// Manual Shopify OAuth + Admin API helpers (no SDK).
import crypto from "crypto";

// Keep this on a supported stable version. Shopify supports each version for ~12 months;
// bump it every 6-9 months (see Technical Guide, "Maintenance").
export const API_VERSION = "2026-10";

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
    cache: "no-store",
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
    cache: "no-store", // Next.js would otherwise cache identical POSTs (e.g. bulk status polls)
  });
  if (res.status === 429 || res.status >= 500) {
    // Throttled or transient: one short back-off retry.
    await new Promise((r) => setTimeout(r, 2000));
    return adminGraphQLOnce(shop, token, query, variables);
  }
  const json = await res.json();
  if (json.errors) throw new Error("GraphQL error: " + JSON.stringify(json.errors));
  return json.data;
}

async function adminGraphQLOnce(shop, token, query, variables) {
  const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
    cache: "no-store", // Next.js would otherwise cache identical POSTs (e.g. bulk status polls)
  });
  const json = await res.json();
  if (json.errors) throw new Error("GraphQL error: " + JSON.stringify(json.errors));
  return json.data;
}

/**
 * Run a Shopify bulk query and return its JSONL rows as objects.
 * Bulk operations have no page caps or query-cost limits, so they scale to
 * very large catalogues and order histories.
 * Throws a BulkTimeoutError if it does not finish before `deadline` (ms epoch).
 */
export class BulkTimeoutError extends Error {
  constructor(m) { super(m); this.name = "BulkTimeoutError"; }
}

/** Start a bulk query and return its operation id. */
export async function startBulkQuery(shop, token, innerQuery) {
  const start = await adminGraphQL(shop, token,
    `mutation run($q: String!) {
      bulkOperationRunQuery(query: $q) {
        bulkOperation { id status }
        userErrors { field message }
      }
    }`, { q: innerQuery });
  const r = start.bulkOperationRunQuery;
  if (r.userErrors && r.userErrors.length) throw new Error("Bulk query rejected: " + JSON.stringify(r.userErrors));
  return r.bulkOperation.id;
}

/** Current state of a bulk operation: { status, url, errorCode, objectCount }. */
export async function bulkStatus(shop, token, id) {
  const d = await adminGraphQL(shop, token,
    `query op($id: ID!) { bulkOperation(id: $id) { id status errorCode objectCount url } }`, { id });
  if (!d.bulkOperation) throw new Error("Bulk operation not found");
  return d.bulkOperation;
}

/**
 * Wait for a bulk operation and return its JSONL rows as objects.
 * Throws BulkTimeoutError (operation keeps running in Shopify) if not done by `deadline`.
 */
export async function awaitBulk(shop, token, id, { deadline } = {}) {
  let delay = 1000;
  for (;;) {
    const op = await bulkStatus(shop, token, id);
    if (op.status === "COMPLETED") {
      if (!op.url) return [];
      const body = await (await fetch(op.url, { cache: "no-store" })).text();
      return body.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    }
    if (op.status === "FAILED" || op.status === "CANCELED" || op.status === "EXPIRED") {
      throw new Error(`Shopify bulk export ${op.status.toLowerCase()}${op.errorCode ? " (" + op.errorCode + ")" : ""}`);
    }
    if (deadline && Date.now() + delay > deadline) {
      const err = new BulkTimeoutError("Shopify export is still running");
      err.op = { id, status: op.status, objectCount: op.objectCount, errorCode: op.errorCode };
      throw err;
    }
    await new Promise((res) => setTimeout(res, delay));
    delay = Math.min(delay * 1.5, 5000);
  }
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
