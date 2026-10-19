// "What's selling" insights: aggregates sales by product, type and supplier, then asks
// Claude to write a short plain-English summary with recommendations.
// Only product-level sales aggregates are sent to the AI; no customer data.

const round = (n, d = 0) => Math.round(n * 10 ** d) / 10 ** d;

function trendPct(recent, earlier) {
  if (earlier > 0) return round(((recent - earlier) / earlier) * 100);
  return recent > 0 ? null : 0; // null = new seller (nothing in the earlier half)
}

/** Build the compact data pack the summary is written from. Pure. */
export function buildInsightData(items, params) {
  const products = new Map();
  let totalUnits = 0;
  for (const i of items) {
    const key = i.productId || i.title;
    let p = products.get(key);
    if (!p) {
      p = { title: i.title, type: i.productType || "Uncategorised", vendor: i.vendor || "Unknown",
        unitsSold: 0, recentSold: 0, stock: 0, worst: "none", variants: 0 };
      products.set(key, p);
    }
    p.unitsSold += i.unitsSold || 0;
    p.recentSold += i.recentSold || 0;
    p.stock += i.stock || 0;
    p.variants++;
    const rank = { now: 0, soon: 1, ok: 2, none: 3 };
    if (rank[i.status] < rank[p.worst]) p.worst = i.status;
    totalUnits += i.unitsSold || 0;
  }
  const prods = [...products.values()];
  const withTrend = prods.map((p) => ({ ...p, trendPct: trendPct(p.recentSold, p.unitsSold - p.recentSold) }));

  function groupBy(field) {
    const m = new Map();
    for (const p of withTrend) {
      const k = p[field];
      const g = m.get(k) || { name: k, unitsSold: 0, recentSold: 0, products: 0, productsSelling: 0 };
      g.unitsSold += p.unitsSold; g.recentSold += p.recentSold; g.products++;
      if (p.unitsSold > 0) g.productsSelling++;
      m.set(k, g);
    }
    return [...m.values()]
      .filter((g) => g.unitsSold > 0)
      .sort((a, b) => b.unitsSold - a.unitsSold)
      .slice(0, 8)
      .map((g) => ({
        name: g.name, unitsSold: g.unitsSold,
        shareOfUnitsPct: totalUnits ? round((g.unitsSold / totalUnits) * 100, 1) : 0,
        trendPct: trendPct(g.recentSold, g.unitsSold - g.recentSold),
        productsSelling: g.productsSelling, productsInRange: g.products,
      }));
  }

  const slim = (p) => ({ title: p.title, type: p.type, vendor: p.vendor, unitsSold: p.unitsSold,
    trendPct: p.trendPct, stockOnHand: p.stock, reorderStatus: p.worst });
  const meaningful = withTrend.filter((p) => p.unitsSold >= 5);
  const unclassified = prods.filter((p) => p.type === "Uncategorised").length;

  return {
    lookbackDays: params.lookbackDays,
    totals: {
      unitsSold: totalUnits,
      productsTracked: prods.length,
      productsWithSales: prods.filter((p) => p.unitsSold > 0).length,
      productsOutOfStockNeedingReorder: prods.filter((p) => p.stock === 0 && p.worst === "now").length,
      productsWithStockButNoSales: prods.filter((p) => p.unitsSold === 0 && p.stock > 0).length,
      pctProductsWithoutProductType: prods.length ? round((unclassified / prods.length) * 100) : 0,
    },
    topProductTypes: groupBy("type"),
    topSuppliers: groupBy("vendor"),
    bestSellers: [...withTrend].sort((a, b) => b.unitsSold - a.unitsSold).filter((p) => p.unitsSold > 0).slice(0, 10).map(slim),
    rising: meaningful.filter((p) => p.trendPct === null || p.trendPct >= 25)
      .sort((a, b) => (b.trendPct ?? 1e6) - (a.trendPct ?? 1e6)).slice(0, 5).map(slim),
    slowing: meaningful.filter((p) => p.trendPct !== null && p.trendPct <= -25)
      .sort((a, b) => a.trendPct - b.trendPct).slice(0, 5).map(slim),
    slowMoversWithMostStock: withTrend.filter((p) => p.unitsSold === 0 && p.stock > 0)
      .sort((a, b) => b.stock - a.stock).slice(0, 5).map(slim),
  };
}

const SYSTEM = `You are a retail merchandising analyst writing for the owner of an Australian Shopify store.
You receive aggregated sales data. Write a short, specific summary of what customers have been buying most and what to do about it.
Rules:
- Use only the numbers provided. Never invent figures, products or reasons.
- trendPct compares the most recent half of the period with the earlier half; null means it only started selling recently.
- Australian English. Plain words, no jargon. No em dashes.
- If a lot of products have no product type, say once that categorising them in Shopify would sharpen this summary.
- Respond with JSON only, no prose around it, in exactly this shape:
{"headline": "one sentence, max 25 words",
 "liked": ["2-4 bullets on which product types, suppliers or products customers liked most, with numbers"],
 "trends": ["1-3 bullets on what is rising or slowing"],
 "recommendations": ["3 specific actions, e.g. what to reorder deeper, promote, bundle or clear"]}`;

/** Ask Claude for the summary. Returns null if not configured or on any failure. */
export async function aiSummary(data) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 45000);
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      cache: "no-store",
      signal: ctrl.signal,
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
        max_tokens: 900,
        system: SYSTEM,
        messages: [{ role: "user", content: "Sales data (JSON):\n" + JSON.stringify(data) }],
      }),
    });
    clearTimeout(t);
    if (!res.ok) { console.warn("AI summary failed:", res.status, await res.text().catch(() => "")); return null; }
    const j = await res.json();
    const text = (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    return normalise(JSON.parse(m[0]));
  } catch (e) {
    console.warn("AI summary error:", e.message || e);
    return null;
  }
}

function normalise(o) {
  const arr = (x) => (Array.isArray(x) ? x.map((s) => String(s).replace(/—/g, ",")).filter(Boolean).slice(0, 5) : []);
  if (!o || typeof o.headline !== "string") return null;
  return { headline: o.headline.replace(/—/g, ","), liked: arr(o.liked), trends: arr(o.trends), recommendations: arr(o.recommendations) };
}

/** Rule-based fallback so the section always shows something useful. */
export function ruleSummary(d) {
  if (!d.totals.unitsSold) {
    return { headline: `No sales in the last ${d.lookbackDays} days, so there is nothing to summarise yet.`, liked: [], trends: [], recommendations: [] };
  }
  const liked = [];
  const t = d.topProductTypes.filter((g) => g.name !== "Uncategorised");
  if (t.length) liked.push(`Top product types: ${t.slice(0, 3).map((g) => `${g.name} (${g.shareOfUnitsPct}% of units)`).join(", ")}.`);
  if (d.topSuppliers.length) liked.push(`Top suppliers: ${d.topSuppliers.slice(0, 3).map((g) => `${g.name} (${g.unitsSold} units)`).join(", ")}.`);
  if (d.bestSellers.length) liked.push(`Best sellers: ${d.bestSellers.slice(0, 3).map((p) => `${p.title} (${p.unitsSold})`).join(", ")}.`);
  const trends = [];
  if (d.rising.length) trends.push(`Rising: ${d.rising.slice(0, 3).map((p) => p.title).join(", ")}.`);
  if (d.slowing.length) trends.push(`Slowing: ${d.slowing.slice(0, 3).map((p) => p.title).join(", ")}.`);
  const recommendations = [];
  const hotLow = d.bestSellers.filter((p) => p.reorderStatus === "now").slice(0, 3);
  if (hotLow.length) recommendations.push(`Reorder best sellers that are running low first: ${hotLow.map((p) => p.title).join(", ")}.`);
  if (d.slowMoversWithMostStock.length) recommendations.push(`Consider a promotion or bundle to clear stock that isn't selling: ${d.slowMoversWithMostStock.slice(0, 3).map((p) => p.title).join(", ")}.`);
  if (d.totals.pctProductsWithoutProductType > 40) recommendations.push(`Add a Product type in Shopify for the ${d.totals.pctProductsWithoutProductType}% of products without one to get clearer category insights.`);
  return {
    headline: `${d.totals.unitsSold.toLocaleString()} units sold across ${d.totals.productsWithSales} products in the last ${d.lookbackDays} days.`,
    liked, trends, recommendations,
  };
}

/** Summary for a dataset: AI when configured, rules otherwise. */
export async function buildSummary(items, params) {
  const data = buildInsightData(items, params);
  if (!data.totals.unitsSold) return { ...ruleSummary(data), source: "rules" };
  const ai = await aiSummary(data);
  return ai ? { ...ai, source: "ai" } : { ...ruleSummary(data), source: "rules" };
}
