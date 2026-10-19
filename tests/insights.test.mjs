import { analyse, stockoutActiveDays } from "../lib/reorder.js";
import { buildInsightData, ruleSummary } from "../lib/insights.js";
let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) pass++; else { fail++; console.log("FAIL:", name); } };
const P = { lookbackDays: 30, leadTimeDays: 14, targetCoverDays: 30,
  vendorOverrides: [{ vendor: "Slow Supplier", leadTimeDays: 45, targetCoverDays: null }] };

const items = analyse([
  { productId: "p1", title: "Linen Dress", productType: "Dresses", vendor: "Slow Supplier", variant: "S", unitsSold: 30, recentSold: 20, stock: 40 },
  { productId: "p1", title: "Linen Dress", productType: "Dresses", vendor: "Slow Supplier", variant: "M", unitsSold: 30, recentSold: 22, stock: 10 },
  { productId: "p2", title: "Linen Dress", productType: "Dresses", vendor: "Other", variant: "", unitsSold: 6, recentSold: 1, stock: 50 },
  { productId: "p3", title: "Wool Scarf", productType: "Accessories", vendor: "Other", variant: "", unitsSold: 0, recentSold: 0, stock: 80 },
], P);
t("vendor override applied", items[0].leadTimeDays === 45 && items[0].overridden && items[0].targetCoverDays === 30);
t("other vendor uses default", items[2].leadTimeDays === 14 && !items[2].overridden);
t("override changes status", items[0].status === "now"); // 40 stock / 1 per day = 40d < 45d lead

const d = buildInsightData(items, P);
t("same-name products kept separate", d.totals.productsTracked === 3);
t("top type is Dresses", d.topProductTypes[0].name === "Dresses" && d.topProductTypes[0].shareOfUnitsPct === 100);
t("rising detects p1", d.rising.some((p) => p.unitsSold === 60));
t("slowing detects p2", d.slowing.some((p) => p.unitsSold === 6));
t("slow mover with stock", d.slowMoversWithMostStock[0].title === "Wool Scarf");
const r = ruleSummary(d);
t("rule summary headline", /66 units/.test(r.headline) && r.recommendations.length >= 1);
t("no em dashes in rule summary", !JSON.stringify(r).includes("—"));

// Stockout adjustment: sold out, last sale 10 days into a 30-day window
const start = Date.UTC(2026, 9, 1);
t("stockout active days", stockoutActiveDays({ stock: 0, unitsSold: 20, lastSaleAt: start + 9 * 86400000 }, start, 30) === 10);
t("floor at 7", stockoutActiveDays({ stock: 0, unitsSold: 5, lastSaleAt: start + 86400000 }, start, 30) === 7);
t("in-stock not adjusted", stockoutActiveDays({ stock: 3, unitsSold: 20, lastSaleAt: start }, start, 30) === undefined);
const adj = analyse([{ title: "X", unitsSold: 20, stock: 0, activeDays: 10 }], { lookbackDays: 30, leadTimeDays: 14, targetCoverDays: 30 })[0];
t("adjusted velocity", Math.abs(adj.velocity - 2) < 1e-9 && adj.reorderQty === 88);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
