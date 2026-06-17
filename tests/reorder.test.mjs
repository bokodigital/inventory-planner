import { computeReorder, analyse, summarise, byUrgency } from "../lib/reorder.js";

let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) pass++; else { fail++; console.log("FAIL:", name); } };

const P = { lookbackDays: 30, leadTimeDays: 14, targetCoverDays: 30 };

// No sales, no stock -> none
let r = computeReorder({ title: "A", unitsSold: 0, stock: 0 }, P);
t("no sales/no stock -> none", r.status === "none" && r.reorderQty === 0);

// No sales but has stock -> none, infinite cover
r = computeReorder({ title: "B", unitsSold: 0, stock: 50 }, P);
t("no sales/has stock -> none + Infinity", r.status === "none" && r.daysCover === Infinity);

// Selling fast, low stock -> order now. 60 sold/30d = 2/day, stock 10 -> cover 5 <=14
r = computeReorder({ title: "C", unitsSold: 60, stock: 10 }, P);
t("fast mover low stock -> now", r.status === "now");
// reorder = ceil(2*(14+30) - 10) = ceil(88-10)=78
t("reorder qty math", r.reorderQty === 78);
t("velocity", Math.abs(r.velocity - 2) < 1e-9);

// Cover between lead and lead+cover -> soon. 30 sold/30d=1/day, stock 20 -> cover 20 (>14, <=44)
r = computeReorder({ title: "D", unitsSold: 30, stock: 20 }, P);
t("mid cover -> soon", r.status === "soon");
t("soon reorder = ceil(1*44-20)=24", r.reorderQty === 24);

// Healthy: 30 sold/30d=1/day, stock 100 -> cover 100 (>44)
r = computeReorder({ title: "E", unitsSold: 30, stock: 100 }, P);
t("high cover -> ok", r.status === "ok");
t("healthy still recommends top-up to target = ceil(1*44-100)=0", r.reorderQty === 0);

// Boundary: cover exactly = leadTime -> now (<=). 14 sold/14? use 28/30? keep simple: velocity 1, stock 14 -> cover 14 == lead -> now
r = computeReorder({ title: "F", unitsSold: 30, stock: 14 }, P);
t("cover == lead -> now", r.status === "now");

// summarise + sort
const items = analyse([
  { title: "C", unitsSold: 60, stock: 10 },
  { title: "E", unitsSold: 30, stock: 100 },
  { title: "D", unitsSold: 30, stock: 20 },
  { title: "B", unitsSold: 0, stock: 50 },
], P);
const s = summarise(items);
t("summary counts", s.total === 4 && s.orderNow === 1 && s.reorderSoon === 1);
t("summary hasSales", s.hasSales === true);
t("units to order > 0", s.unitsToOrder === 78 + 24);
const ordered = byUrgency(items);
t("urgency sort: now first", ordered[0].status === "now");
t("urgency sort: none last", ordered[ordered.length - 1].status === "none");

// guards: bad inputs
r = computeReorder({ title: "G", unitsSold: -5, stock: -3 }, { lookbackDays: 0 });
t("negative/zero guards", r.status === "none" && r.reorderQty === 0 && r.daysCover === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
