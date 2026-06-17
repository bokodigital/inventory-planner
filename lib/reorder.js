// ───────────────────────────────────────────────────────────────
// Pure reorder engine — no dependencies, fully unit-testable.
// Same math used by the Cowork planner, generalised for the SaaS.
// ───────────────────────────────────────────────────────────────

export const STATUS = {
  now:  { key: "now",  label: "Order now",    rank: 0 },
  soon: { key: "soon", label: "Reorder soon", rank: 1 },
  ok:   { key: "ok",   label: "Healthy",      rank: 2 },
  none: { key: "none", label: "No recent sales", rank: 3 },
};

/**
 * @param {{title:string, variant?:string, unitsSold:number, stock:number}} v
 * @param {{lookbackDays:number, leadTimeDays:number, targetCoverDays:number}} p
 */
export function computeReorder(v, p) {
  const lookbackDays = Math.max(1, p.lookbackDays || 30);
  const leadTimeDays = Math.max(0, p.leadTimeDays ?? 14);
  const targetCoverDays = Math.max(1, p.targetCoverDays ?? 30);
  const unitsSold = Math.max(0, Number(v.unitsSold) || 0);
  const stock = Math.max(0, Number(v.stock) || 0);

  const velocity = unitsSold / lookbackDays;            // units/day
  let daysCover, status, reorderQty;

  if (velocity <= 0) {
    daysCover = stock > 0 ? Infinity : 0;
    status = STATUS.none.key;
    reorderQty = 0;
  } else {
    daysCover = stock / velocity;
    reorderQty = Math.max(0, Math.ceil(velocity * (leadTimeDays + targetCoverDays) - stock));
    if (daysCover <= leadTimeDays) status = STATUS.now.key;
    else if (daysCover <= leadTimeDays + targetCoverDays) status = STATUS.soon.key;
    else status = STATUS.ok.key;
  }
  return { ...v, velocity, daysCover, status, reorderQty };
}

export function analyse(variants, params) {
  return variants.map((v) => computeReorder(v, params));
}

/** Sort by urgency (status rank, then least days of cover first). */
export function byUrgency(items) {
  return items.slice().sort((a, b) => {
    const ra = STATUS[a.status].rank, rb = STATUS[b.status].rank;
    if (ra !== rb) return ra - rb;
    return Math.min(a.daysCover, 1e9) - Math.min(b.daysCover, 1e9);
  });
}

export function summarise(items) {
  const now = items.filter((i) => i.status === "now");
  const soon = items.filter((i) => i.status === "soon");
  return {
    total: items.length,
    orderNow: now.length,
    reorderSoon: soon.length,
    unitsToOrder: items.reduce((s, i) => s + i.reorderQty, 0),
    hasSales: items.some((i) => i.unitsSold > 0),
    now: byUrgency(now),
    soon: byUrgency(soon),
  };
}
