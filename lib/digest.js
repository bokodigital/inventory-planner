// Builds reorder recommendations for a shop from live Shopify data.
// Uses Shopify bulk operations so there is no cap on catalogue size or order volume.
import { startBulkQuery, awaitBulk } from "@/lib/shopify";
import { decrypt } from "@/lib/crypto";
import { analyse, summarise, stockoutActiveDays } from "@/lib/reorder";

export const CACHE_VERSION = 2;

/**
 * Shopify only lets apps read the last 60 days of orders unless the app has been
 * granted the read_all_orders scope. Clamp the lookback so velocity is never
 * divided by days we can't see.
 */
export function maxLookbackFor(shopRow) {
  const scopes = String((shopRow && shopRow.scopes) || "");
  return /(^|,)\s*read_all_orders\s*(,|$)/.test(scopes) ? 365 : 60;
}

export function clampLookback(shopRow, requested) {
  const n = parseInt(requested, 10);
  const v = Number.isNaN(n) ? 30 : n;
  return Math.min(maxLookbackFor(shopRow), Math.max(7, v));
}

const VARIANTS_QUERY = `{
  productVariants {
    edges { node {
      id title sku inventoryQuantity
      inventoryItem { requiresShipping tracked }
      product { id title isGiftCard productType vendor status }
    } }
  }
}`;

function ordersQuery(sinceDate) {
  // Date-only (YYYY-MM-DD): full ISO timestamps were found to silently match nothing.
  return `{
  orders(query: "created_at:>=${sinceDate}") {
    edges { node {
      id createdAt cancelledAt test
      lineItems { edges { node { id currentQuantity refundableQuantity variant { id } } } }
    } }
  }
}`;
}

function parseInventory(rows) {
  const variants = {}; // variantGID -> row
  let excluded = 0;
  for (const v of rows) {
    if (!v.id || !v.product) continue;
    const p = v.product;
    if (p.isGiftCard) { excluded++; continue; }                                   // gift cards
    if (p.status === "ARCHIVED") { excluded++; continue; }                         // archived products
    if (v.inventoryItem && v.inventoryItem.requiresShipping === false) { excluded++; continue; } // digital / services
    if (v.inventoryItem && v.inventoryItem.tracked === false) { excluded++; continue; }          // stock not tracked in Shopify
    variants[v.id] = {
      productId: p.id,
      title: p.title,
      productType: (p.productType || "").trim(),
      vendor: (p.vendor || "").trim(),
      variant: v.title === "Default Title" ? "" : (v.title || ""),
      sku: v.sku || "",
      stock: Math.max(0, v.inventoryQuantity ?? 0),
      unitsSold: 0,
      recentSold: 0,      // units sold in the most recent half of the window (for trends)
      lastSaleAt: null,
    };
  }
  return { variants, excluded };
}

function sinceDate(lookbackDays) {
  return new Date(Date.now() - lookbackDays * 86400000).toISOString().slice(0, 10);
}

function addSales(rows, variants, lookbackDays) {
  const windowStart = Date.now() - lookbackDays * 86400000;
  const mid = windowStart + (lookbackDays * 86400000) / 2;

  // Pass 1: orders (rows without __parentId). Pass 2: their line items.
  const orders = new Map();
  let orderCount = 0;
  for (const r of rows) {
    if (r.__parentId) continue;
    const valid = !r.cancelledAt && !r.test;
    orders.set(r.id, valid ? new Date(r.createdAt).getTime() : null);
    if (valid) orderCount++;
  }
  for (const r of rows) {
    if (!r.__parentId) continue;
    const createdAt = orders.get(r.__parentId);
    if (!createdAt) continue;                                 // cancelled / test order
    const vid = r.variant && r.variant.id;
    if (!vid || !variants[vid]) continue;                     // digital / untracked / deleted product
    // Net of refunds and order edits.
    const qty = Math.max(0, Math.min(r.currentQuantity ?? 0, r.refundableQuantity ?? r.currentQuantity ?? 0));
    if (!qty) continue;
    const v = variants[vid];
    v.unitsSold += qty;
    if (createdAt >= mid) v.recentSold += qty;
    if (!v.lastSaleAt || createdAt > v.lastSaleAt) v.lastSaleAt = createdAt;
  }

  // Items sold out right now: measure their rate over the days they were actually on sale.
  for (const v of Object.values(variants)) {
    const ad = stockoutActiveDays(v, windowStart, lookbackDays);
    if (ad) v.activeDays = ad;
    if (v.lastSaleAt) v.lastSaleAt = new Date(v.lastSaleAt).toISOString();
  }
  return { orderCount };
}

/**
 * Fetch raw per-variant data (stock + net units sold) from Shopify. Cacheable.
 * Both bulk exports run in parallel. Their ids are saved on the Shop row, so if this
 * request runs out of time the next request (dashboard "Try again", cron, test email)
 * resumes waiting on the same exports instead of starting over.
 * Returns { v, list, meta }.
 */
export async function fetchVariants(shopRow, lookbackDays, { deadline, prisma } = {}) {
  const token = decrypt(shopRow.accessToken);
  const shop = shopRow.shopDomain;
  const dl = deadline || Date.now() + 240000;
  const t0 = Date.now();

  let pending = null;
  try { pending = shopRow.pendingBulk ? JSON.parse(shopRow.pendingBulk) : null; } catch {}
  const reusable = pending && pending.lookbackDays === lookbackDays && pending.since === sinceDate(lookbackDays)
    && Date.now() - pending.startedAt < 3 * 3600 * 1000;

  if (!reusable) {
    const [variantsOp, ordersOp] = await Promise.all([
      startBulkQuery(shop, token, VARIANTS_QUERY),
      startBulkQuery(shop, token, ordersQuery(sinceDate(lookbackDays))),
    ]);
    pending = { lookbackDays, since: sinceDate(lookbackDays), variantsOp, ordersOp, startedAt: Date.now() };
    if (prisma) await prisma.shop.update({ where: { id: shopRow.id }, data: { pendingBulk: JSON.stringify(pending) } }).catch(() => {});
    shopRow.pendingBulk = JSON.stringify(pending);
  }

  let invRows, orderRows;
  try {
    [invRows, orderRows] = await Promise.all([
      awaitBulk(shop, token, pending.variantsOp, { deadline: dl }),
      awaitBulk(shop, token, pending.ordersOp, { deadline: dl }),
    ]);
  } catch (e) {
    // A failed (not just slow) export must not be resumed: clear it so the next try starts fresh.
    if (!(e && e.name === "BulkTimeoutError") && prisma) {
      await prisma.shop.update({ where: { id: shopRow.id }, data: { pendingBulk: null } }).catch(() => {});
    }
    console.log(`[fetchVariants] ${shop} waited ${Math.round((Date.now() - t0) / 1000)}s: ${e.message} ${JSON.stringify(e.op || {})} pending=${JSON.stringify(pending)}`);
    throw e;
  }

  const { variants, excluded } = parseInventory(invRows);
  const { orderCount } = addSales(orderRows, variants, lookbackDays);
  if (prisma) await prisma.shop.update({ where: { id: shopRow.id }, data: { pendingBulk: null } }).catch(() => {});
  console.log(`[fetchVariants] ${shop} done in ${Math.round((Date.now() - t0) / 1000)}s: ${invRows.length} variant rows, ${orderRows.length} order rows`);
  return {
    v: CACHE_VERSION,
    list: Object.values(variants),
    meta: { lookbackDays, orderCount, excluded, fetchedAt: new Date().toISOString() },
  };
}

/** Read a cache blob; returns null for missing / old-format caches. */
export function readCache(shopRow, lookbackDays, maxAgeMs) {
  if (!shopRow.cacheVariants || !shopRow.cacheAt) return null;
  if (shopRow.cacheLookback !== lookbackDays) return null;
  if (Date.now() - new Date(shopRow.cacheAt).getTime() > maxAgeMs) return null;
  try {
    const blob = JSON.parse(shopRow.cacheVariants);
    return blob && blob.v === CACHE_VERSION && Array.isArray(blob.list) ? blob : null;
  } catch { return null; }
}

export function parseOverrides(settings) {
  if (!settings || !settings.vendorOverrides) return [];
  try {
    const o = JSON.parse(settings.vendorOverrides);
    return Array.isArray(o) ? o : [];
  } catch { return []; }
}

// Pure step: turn raw variants into reorder recommendations. Cheap (no network).
export function analyseVariants(list, params) {
  const items = analyse(list, params);
  return { items, summary: summarise(items), params };
}

/** Full build used by the scheduled digest and test email. Reuses a fresh cache. */
export async function buildReorder(prisma, shopRow, settings, { deadline } = {}) {
  const lookbackDays = clampLookback(shopRow, settings.lookbackDays ?? 30);
  const params = {
    lookbackDays,
    leadTimeDays: settings.leadTimeDays ?? 14,
    targetCoverDays: settings.targetCoverDays ?? 30,
    vendorOverrides: parseOverrides(settings),
  };
  let blob = readCache(shopRow, lookbackDays, 60 * 60 * 1000);
  if (!blob) {
    blob = await fetchVariants(shopRow, lookbackDays, { deadline, prisma });
    await saveCache(prisma, shopRow, blob);
  }
  return { ...analyseVariants(blob.list, params), meta: blob.meta };
}

export async function saveCache(prisma, shopRow, blob) {
  await prisma.shop.update({
    where: { id: shopRow.id },
    data: { cacheVariants: JSON.stringify(blob), cacheLookback: blob.meta.lookbackDays, cacheAt: new Date() },
  }).catch(() => {});
}
